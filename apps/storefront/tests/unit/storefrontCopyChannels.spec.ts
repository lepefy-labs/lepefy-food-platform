import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import type { TenantNotificationContext } from '../../src/lib/notifications/getTenantNotificationContext';
import { orderConfirmedEmail } from '../../src/lib/notifications/customerEmails';
import { loadOrderEmailItems } from '../../src/lib/notifications/orderEmailItems';
import { orderLineDetail, resolveSellingFormat } from '../../src/lib/storefrontCopy/sellingFormat';
import { buildSystemPrompt, promptProductLine, type MatchedProductContext } from '../../src/lib/ai/chatbox';
import { buildMatchedProductContexts } from '../../src/lib/ai/nalaPromptProducts';
import { orderStageLabel, orderStatusReply } from '../../src/lib/whatsapp/automation/replies';
import type { OrderPortalViewModel } from '../../src/lib/orders/portal/portalViewModel';
import { fakeDb } from './helpers/fakeSupabase';

/** Intl fr-FR uses (narrow) no-break spaces around amounts. */
const norm = (value: string) => value.replace(/[  ]/g, ' ');

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const KAOLIN = '33333333-3333-4333-8333-333333333333';
const MALTA = '44444444-4444-4444-8444-444444444444';

const context = {
  tenantId: TENANT,
  tenantSlug: 'chloefood',
  tenantName: 'Chloé Food',
  storefrontUrl: 'https://shop.example',
  locale: 'fr-FR',
  currency: 'EUR',
  branding: { logoUrl: null, primaryColor: '#8a2be2', secondaryColor: '#ffb000', accentColor: '#fff' },
  emailBranding: { fromName: 'Chloé Food', fromEmail: 'noreply@lepefy.com', supportEmail: null, whatsappNumber: null },
  business: { city: 'Milano', country: 'IT', legalAddress: null },
  pickup: { address: null, mapsUrl: null, hours: null },
} satisfies TenantNotificationContext;

const order = { orderNumber: '#ABCD1234', fullName: 'Awa', orderTrackingLink: 'https://shop.example/orders/x?token=t' };

test.describe('ligne de commande', () => {
  test('unité connue : quantité comptée, contenu et prix unitaire', () => {
    const sachet = resolveSellingFormat({ sale_unit: 'sachet', net_content_value: 150, net_content_unit: 'g' });
    expect(norm(orderLineDetail(3, 3, sachet))).toBe('3 sachets de 150 g · 3,00 € le sachet');
    expect(norm(orderLineDetail(3, 1, sachet))).toBe('1 sachet de 150 g · 3,00 € le sachet');
    const lot = resolveSellingFormat({ sale_unit: 'lot', pack_count: 3, net_content_value: 400, net_content_unit: 'g' });
    expect(norm(orderLineDetail(5, 2, lot))).toBe('2 lots de 3 × 400 g · 5,00 € le lot');
    const bottle = resolveSellingFormat({ sale_unit: 'bouteille' });
    expect(norm(orderLineDetail(1.5, 12, bottle))).toBe('12 bouteilles · 1,50 € la bouteille');
  });

  test('sans unité : « × » et la même phrase que le catalogue', () => {
    expect(norm(orderLineDetail(1.8, 2, resolveSellingFormat(null)))).toBe("2 × 1,80 € l'article");
    expect(norm(orderLineDetail(2, 1, resolveSellingFormat({ net_quantity_display: '500 g' })))).toBe('1 × 2,00 € les 500 g');
    expect(norm(orderLineDetail(4.5, 2, resolveSellingFormat({ sale_unit: 'kg' })))).toBe('2 × 4,50 € le kilo');
  });
});

test.describe('email « Commande confirmée »', () => {
  const items = [
    { name: 'Kaolin', quantity: 3, unitPrice: 3, format: { sale_unit: 'sachet', net_content_value: 150, net_content_unit: 'g' } },
    { name: 'Bobolo <sous vide>', quantity: 1, unitPrice: 1.8, format: null },
  ];

  test('liste les articles avec leur format et un récapitulatif sans ambiguïté', () => {
    const html = norm(orderConfirmedEmail(context, {
      ...order, fulfillmentType: 'delivery', total: 20.7, shippingTotal: 9.9,
      shippingAddress: { line1: 'Via Verdi 2', postal_code: '20100', city: 'Milano', country: 'IT' }, items,
    }).html);
    expect(html).toContain('Votre commande');
    expect(html).toContain('3 sachets de 150 g · 3,00 € le sachet');
    expect(html).toContain('9,00 €');
    expect(html).toContain('Bobolo &lt;sous vide&gt;');
    expect(html).toContain("1 × 1,80 € l&#39;article");
    expect(html).toContain('Prix des produits');
    expect(html).toContain('10,80 €');
    expect(html).toContain('Prix de livraison');
    expect(html).toContain('Total payé');
    expect(html).toContain('20,70 €');
    expect(html).toContain('TVA incluse');
    expect(html).not.toContain('Frais de livraison');
    expect(html).not.toContain('💰 Total');
  });

  test('avantage ambassadeur affiché seulement s’il existe ; total jamais recalculé', () => {
    const withDiscount = norm(orderConfirmedEmail(context, {
      ...order, fulfillmentType: 'pickup', total: 8.8, shippingTotal: 0, shippingAddress: null, items, discount: 2,
    }).html);
    expect(withDiscount).toContain('Avantage ambassadeur');
    expect(withDiscount).toContain('-2,00 €');
    expect(withDiscount).toContain('8,80 €');
    expect(withDiscount).toContain('Click &amp; Collect');
    expect(withDiscount).not.toContain('Prix de livraison');
    const without = orderConfirmedEmail(context, { ...order, fulfillmentType: 'pickup', total: 10.8, shippingTotal: 0, shippingAddress: null, items });
    expect(without.html).not.toContain('Avantage ambassadeur');
  });

  test('sans lignes (anciens appels) : total payé quand même', () => {
    const html = norm(orderConfirmedEmail(context, { ...order, fulfillmentType: 'pickup', total: 42.5, shippingTotal: 0, shippingAddress: null }).html);
    expect(html).toContain('Total payé');
    expect(html).toContain('42,50 €');
    expect(html).not.toContain('Prix des produits');
  });

  test('format lu par tenant ; une erreur ne bloque jamais l’email', async () => {
    const db = fakeDb({
      products: [
        { id: KAOLIN, tenant_id: TENANT, sale_unit: 'sachet', net_content_value: '150.000', net_content_unit: 'g', pack_count: null, net_quantity_display: null },
        { id: MALTA, tenant_id: OTHER_TENANT, sale_unit: 'bouteille', net_content_value: null, net_content_unit: null, pack_count: null, net_quantity_display: null },
      ],
    });
    const source = [
      { productId: KAOLIN, name: 'Kaolin', price: 3, quantity: 2 },
      { productId: MALTA, name: 'Malta', price: 1.5, quantity: 12 },
      { productId: null, name: 'Article supprimé', price: 1, quantity: 1 },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines = await loadOrderEmailItems(db as any, TENANT, source);
    expect(lines[0]).toMatchObject({ name: 'Kaolin', quantity: 2, unitPrice: 3, format: { sale_unit: 'sachet', net_content_value: 150 } });
    expect(lines[1]!.format).toBeNull();
    expect(lines[2]!.format).toBeNull();

    db.failures.products = { code: '42P01', message: 'boom' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fallback = await loadOrderEmailItems(db as any, TENANT, source);
    expect(fallback.map((line) => line.format)).toEqual([null, null, null]);
    expect(fallback.map((line) => line.unitPrice)).toEqual([3, 1.5, 1]);
  });
});

test.describe('contexte produit de Nala', () => {
  const base: MatchedProductContext = {
    name: 'Kaolin', price: 3, currency: 'EUR', stock: 42, storageType: 'dry', categoryName: 'Épicerie',
    sellingFormat: { sale_unit: 'sachet', net_content_value: 150, net_content_unit: 'g' },
  };

  test('prix avec format, disponibilité sans chiffre, jamais de poids logistique', () => {
    expect(norm(promptProductLine(base))).toBe('- Kaolin (Épicerie) — 3,00 € le sachet de 150 g — disponible');
    expect(norm(promptProductLine({ ...base, stock: 0 }))).toBe('- Kaolin (Épicerie) — 3,00 € le sachet de 150 g — pas disponible');
    expect(norm(promptProductLine({ ...base, stock: null }))).toContain('pas disponible');
    expect(norm(promptProductLine({ ...base, sellingFormat: null }))).toContain("3,00 € l'article");
  });

  test('minimum et groupe à mélanger, avec les mots du site', () => {
    expect(norm(promptProductLine({ ...base, minOrderQuantity: 2 })))
      .toBe('- Kaolin (Épicerie) — 3,00 € le sachet de 150 g — disponible — Achetez 2 sachets minimum');
    expect(norm(promptProductLine({ ...base, stock: 1, minOrderQuantity: 2 }))).toContain('pas disponible pour le moment');
    expect(norm(promptProductLine({ ...base, quantityGroup: { name: 'Boissons', minimum: 12 } })))
      .toContain('Boissons : mélangez les produits pour arriver à 12');
  });

  test('le prompt contient les règles et aucun stock chiffré', () => {
    const prompt = norm(buildSystemPrompt({
      tenantName: 'Chloé Food', locales: ['fr'], whatsappNumber: null, extraContext: null,
      matchedProducts: [base], knowledgeSnippets: [],
    }));
    expect(prompt).toContain('3,00 € le sachet de 150 g');
    expect(prompt).toContain("n'invente jamais un poids");
    expect(prompt).toContain('ne donne jamais le nombre d');
    expect(prompt).not.toMatch(/en stock \(\d+\)|\d+g\b|3 EUR/);
  });

  test('mapping : groupes du tenant, aucun weight_grams transmis', async () => {
    const db = fakeDb({
      purchase_quantity_groups: [
        { name: 'Boissons', min_quantity: 12, tenant_id: TENANT, active: true, purchase_quantity_group_products: [{ product_id: MALTA }] },
        { name: 'Autre tenant', min_quantity: 99, tenant_id: OTHER_TENANT, active: true, purchase_quantity_group_products: [{ product_id: KAOLIN }] },
      ],
    });
    const rows = [
      { id: KAOLIN, name: 'Kaolin', price: 3, stock: 5, storage_type: 'dry', category_name: 'Épicerie', min_order_quantity: 1, order_quantity_step: 1, sale_unit: 'sachet', net_content_value: '150', net_content_unit: 'g', weight_grams: 1000 },
      { id: MALTA, name: 'Malta', price: 1.5, stock: 50, storage_type: 'dry', category_name: 'Boissons', min_order_quantity: 1, order_quantity_step: 1, sale_unit: 'bouteille' },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const contexts = await buildMatchedProductContexts(db as any, TENANT, 'EUR', rows);
    expect(contexts[0]!.quantityGroup).toBeNull();
    expect(contexts[1]!.quantityGroup).toEqual({ name: 'Boissons', minimum: 12 });
    expect(JSON.stringify(contexts)).not.toContain('weight');
    expect(contexts[0]!.sellingFormat).toMatchObject({ net_content_value: 150 });
  });
});

test.describe('WhatsApp : état de commande dans la langue du client', () => {
  function portal(overrides: Partial<OrderPortalViewModel>): OrderPortalViewModel {
    return {
      ref: '#3F9A21C0', date: '9 oct.', stage: 'preparing', stageLabel: 'En préparation', headline: '', description: 'Nous préparons votre commande.',
      fulfillment: 'delivery', shipment: null, pickup: null, items: [], primary: null, secondary: [], support: [], appUrl: null,
      tenant: { name: 'Chloé Food', logoUrl: null },
      ...overrides,
    } as OrderPortalViewModel;
  }

  test('le français garde le libellé du portail ; italien et anglais sont traduits', () => {
    expect(orderStageLabel('fr', portal({}))).toBe('En préparation');
    expect(orderStageLabel('it', portal({}))).toBe('In preparazione');
    expect(orderStageLabel('en', portal({}))).toBe('Being prepared');
    expect(orderStatusReply('it', portal({}), null)).toContain('*In preparazione*');
    expect(orderStatusReply('it', portal({}), null)).not.toContain('En préparation');
  });

  test('retrait terminé, conflit de stock et annulation', () => {
    expect(orderStageLabel('it', portal({ stage: 'delivered', stageLabel: 'Retirée', fulfillment: 'pickup' }))).toBe('Ritirato');
    expect(orderStageLabel('en', portal({ stage: 'delivered', stageLabel: 'Livrée' }))).toBe('Delivered');
    expect(orderStageLabel('it', portal({ stage: 'cancelled', stageLabel: 'Action requise' }))).toBe('Da verificare');
    expect(orderStageLabel('en', portal({ stage: 'cancelled', stageLabel: 'Annulée' }))).toBe('Cancelled');
  });
});

test.describe('garde-fous Nala et checkout', () => {
  for (const file of ['src/components/chat/NalaProductActionCard.tsx', 'src/components/chat/NalaCartPlanCard.tsx', 'src/components/chat/ChatWidget.tsx']) {
    test(`${file} : pas de jargon ni de texte sous 12 px`, () => {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/text-\[(9|10|10\.5|11|11\.5)px\]/);
      expect(source).not.toMatch(/unité\(s\)|unités\.|Minimum \{|minimum \{groupMinimum\}/);
    });
  }

  test('le checkout actif porte le pré-contrôle ; l’ancien code mort a disparu', () => {
    const flow = readFileSync('src/app/(shop)/checkout/CheckoutFlow.tsx', 'utf8');
    expect(flow).toContain('useCartPurchaseGate(items)');
    expect(flow).toContain('purchaseGate.canProceed');
    expect(readFileSync('src/app/(shop)/cart/CartPurchaseClient.tsx', 'utf8')).toContain('useCartPurchaseGate(items)');
    for (const dead of ['src/app/(shop)/cart/CartClient.tsx', 'src/app/(shop)/checkout/CheckoutForm.tsx', 'src/app/(shop)/checkout/CheckoutOrderSummary.tsx']) {
      expect(existsSync(dead)).toBe(false);
    }
  });

  test('le prompt de Nala ne reçoit plus weight_grams', () => {
    for (const file of ['src/lib/ai/chatbox.ts', 'src/lib/ai/nalaPromptProducts.ts', 'src/lib/ai/nalaChannelTurn.ts']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/weightGrams|weight_grams:/);
    }
  });
});
