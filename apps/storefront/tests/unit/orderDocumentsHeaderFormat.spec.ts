import { test, expect } from '@playwright/test';
import type { Tenant } from '@lepefy/types';
import { ORDER_DOCUMENTS_DEFAULTS } from '../../src/lib/orders/documents/settings';
import {
  buildPackingSlipViewModel, buildPickingListViewModel,
  type DocumentItemRow, type DocumentOrderRow, type DocumentTenant,
} from '../../src/lib/orders/documents/viewModels';
import { pickingListHtml } from '../../src/lib/orders/documents/pickingListHtml';
import { capitalizeFirst, documentFooterHtml, formatDocumentDate } from '../../src/lib/orders/documents/documentHtml';
import { documentMarginsMm } from '../../src/lib/orders/documents/formats';
import { gotenbergOptionFields } from '../../src/lib/labels/gotenberg';
import { packingSlipHtml } from '../../src/lib/orders/documents/packingSlipHtml';
import { orderItemFormatLabel } from '../../src/lib/orders/documents/itemFormat';
import { loadOrderDocumentData } from '../../src/lib/orders/documents/loadOrderDocumentData';
import { renderOrderDocuments } from '../../src/lib/orders/documents/renderOrderDocuments';
import { fakeDb, type FakeDb } from './helpers/fakeSupabase';

/**
 * Liste de préparation : en-tête deux colonnes avec encadré CP/ville.
 * Récapitulatif client : format acheté depuis `order_items.format_snapshot` (162).
 */

const ORDER_A = '163835b8-1111-4222-8333-444455556666';
const ORDER_B = 'cc4314fe-9a1b-4c2e-8d77-1f0e5b3a9c21';
const ORDER_OTHER_TENANT = 'aaaaaaaa-1111-4222-8333-444455556666';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

type Address = Record<string, unknown>;

function order(id: string, overrides: Partial<DocumentOrderRow> = {}): DocumentOrderRow & { tenant_id: string } {
  return {
    id, tenant_id: TENANT_A, created_at: '2026-10-05T07:14:00Z', status: 'preparing', fulfillment_type: 'delivery',
    full_name: 'Awa Diallo',
    shipping_address: { full_name: 'Awa Diallo', line1: '12 rue Oberkampf', postal_code: '75011', city: 'Paris', country: 'FR' },
    shipping_details: { totalWeightG: 2400 }, shipping_cost: 9.9, total: 30,
    ...overrides,
  };
}

function withAddress(address: Address, overrides: Partial<DocumentOrderRow> = {}) {
  return order(ORDER_A, { shipping_address: address, ...overrides });
}

function item(orderId: string, name: string, overrides: Partial<DocumentItemRow> = {}): DocumentItemRow & { tenant_id: string } {
  return {
    order_id: orderId, tenant_id: TENANT_A, product_id: `p-${name}`, name, name_alt: null, price: 5, quantity: 2, subtotal: 10,
    storage_type: 'dry', warehouse_location: null, ...overrides,
  };
}

const ITEMS = [item(ORDER_A, 'Kaolin'), item(ORDER_A, 'Mitoumba', { quantity: 1, subtotal: 5 })];

function picking(orderRow: DocumentOrderRow, showDeliveryAddress = false) {
  return buildPickingListViewModel({ order: orderRow, items: ITEMS, tenant: { name: 'Chloe Food' }, carton: null, showDeliveryAddress });
}

/** Colonne gauche (identification + adresse) et bloc marque (logo / nom) d'une section. */
function headParts(html: string): { left: string; right: string } {
  const head = html.slice(html.indexOf('<div class="pl-head">'), html.indexOf('<div class="pl-section'));
  const split = head.indexOf('<div class="pl-brandbox">');
  return { left: head.slice(0, split), right: head.slice(split) };
}

// ─── A. Liste de préparation : en-tête ──────────────────────────────────────

test('picking header: date, title and reference on the left, address block with bold postal code and city under the street', () => {
  for (const format of ['a5', 'a4'] as const) {
    const html = pickingListHtml([picking(order(ORDER_A), true)], format);
    const { left } = headParts(html);
    expect(left.indexOf('pl-date')).toBeLessThan(left.indexOf('LISTE DE PRÉPARATION'));
    expect(left).toContain('<div class="pl-date">Lundi 05/10/2026 · 09:14</div>');
    expect(left).toContain('<div class="pl-meta pl-when pl-ref-line"><span>Commande #163835B8</span><span class="pl-mode">EXPÉDITION</span></div>');
    expect(left).toContain('<div class="pl-customer">Awa Diallo</div>');
    const street = left.indexOf('12 rue Oberkampf');
    const postalCity = left.indexOf('<div class="pl-postal-city">75011 Paris</div>');
    expect(street).toBeGreaterThan(-1);
    expect(postalCity).toBeGreaterThan(street);
    expect(left).toContain('<div class="pl-route">France</div>');
    expect(html).not.toContain('pl-dest');
  }
  const a5 = pickingListHtml([picking(order(ORDER_A))], 'a5');
  const a4 = pickingListHtml([picking(order(ORDER_A))], 'a4');
  expect(a5).toContain('.format-a5 .pl-postal-city { font-size: 11pt; }');
  expect(a4).toContain('.format-a4 .pl-postal-city { font-size: 12pt; }');
  expect(a5).toContain('.pl-postal-city { font-weight: 700;');
  expect(a5).toContain('overflow-wrap: break-word');
  expect(a5).not.toContain('text-overflow');
});

test('picking header: postal code and city stay when the full address is disabled, nothing else of the address does', () => {
  const vm = picking(order(ORDER_A, { shipping_address: { full_name: 'Moussa Traoré', company_name: 'ACME', line1: '3 rue Lepic', line2: 'Bât. B', postal_code: '75018', city: 'Paris', country: 'FR' } }), false);
  for (const format of ['a5', 'a4'] as const) {
    const { left } = headParts(pickingListHtml([vm], format));
    expect(left).toContain('<div class="pl-postal-city">75018 Paris</div>');
    for (const hidden of ['Lepic', 'Bât. B', 'ACME', 'Moussa']) expect(left).not.toContain(hidden);
  }
  const giftAddress = { full_name: 'Moussa Traoré', company_name: 'ACME', line1: '3 rue Lepic', line2: 'Bât. B', postal_code: '75018', city: 'Paris', country: 'FR' };
  const shown = headParts(pickingListHtml([picking(order(ORDER_A, { shipping_address: giftAddress }), true)], 'a5')).left;
  expect(shown).toContain('Destinataire : Moussa Traoré');
  expect(shown).toContain('Entreprise : ACME');
  expect(shown.indexOf('Bât. B')).toBeLessThan(shown.indexOf('75018 Paris'));
});

test('picking header: leading zeros and alphanumeric postal codes kept verbatim, countries compact', () => {
  const rome = headParts(pickingListHtml([picking(withAddress({ line1: 'Via Prenestina 1', postal_code: '00132', city: 'Roma', country: 'IT' }))], 'a5')).left;
  expect(rome).toContain('<div class="pl-postal-city">00132 Roma</div>');
  expect(rome).toContain('<div class="pl-route">Italie</div>');
  const london = headParts(pickingListHtml([picking(withAddress({ postal_code: 'SW1A 1AA', city: 'London', country: 'GB' }))], 'a4')).left;
  expect(london).toContain('SW1A 1AA London');
  const free = headParts(pickingListHtml([picking(withAddress({ postal_code: '1000', city: 'Bruxelles', country: 'Belgique' }))], 'a5')).left;
  expect(free).toContain('<div class="pl-route">Belgique</div>');
  // Un CP numérique en JSON reste lisible (ses zéros perdus ne sont jamais inventés).
  const numeric = picking(withAddress({ postal_code: 6100, city: 'Bergamo', country: 'IT' }));
  expect(numeric.destinationParts).toEqual({ postalCode: '6100', city: 'Bergamo', country: 'Italie' });
});

test('picking header: long cities wrap and are never truncated, accents and apostrophes escaped', () => {
  const html = pickingListHtml([picking(withAddress({ line1: "Via dell'Industria 4", postal_code: '20051', city: "CASSINA DE' PECCHI", country: 'IT' }), true)], 'a5');
  expect(html).toContain('20051 CASSINA DE&#39; PECCHI');
  expect(html).toContain('Via dell&#39;Industria 4');
  const long = pickingListHtml([picking(withAddress({ postal_code: '13210', city: 'Saint-Rémy-de-Provence-sur-Durance-en-Très-Longue-Commune', country: 'FR' }))], 'a5');
  expect(long).toContain('13210 Saint-Rémy-de-Provence-sur-Durance-en-Très-Longue-Commune');
  expect(long).not.toContain('text-overflow');
  expect(long).not.toContain('white-space: nowrap; margin');
});

test('picking header: gift recipient and complement kept, all values escaped', () => {
  const vm = picking(withAddress({
    full_name: 'Moussa <b>Traoré</b>', line1: '3 rue Lepic', line2: 'Bât. B & escalier 2', postal_code: '75018', city: 'Paris <i>18e</i>', country: 'FR',
  }, { full_name: 'Awa "Diallo"' }), true);
  const html = pickingListHtml([vm], 'a5');
  const { left } = headParts(html);
  expect(left).toContain('Destinataire : Moussa &lt;b&gt;Traoré&lt;/b&gt;');
  expect(left).toContain('Bât. B &amp; escalier 2');
  expect(left).toContain('Awa &quot;Diallo&quot;');
  expect(left).toContain('75018 Paris &lt;i&gt;18e&lt;/i&gt;');
  expect(html).not.toContain('<b>Traoré</b>');
  expect(html).not.toContain('<i>18e</i>');
});

test('picking header: incomplete address degrades without inventing anything', () => {
  expect(headParts(pickingListHtml([picking(withAddress({ city: 'Lyon' }))], 'a5')).left).toContain('<div class="pl-postal-city">Lyon</div>');
  const postalOnly = headParts(pickingListHtml([picking(withAddress({ postal_code: '69002', country: 'FR' }))], 'a5')).left;
  expect(postalOnly).toContain('<div class="pl-postal-city">69002</div>');
  for (const address of [{}, null]) {
    const html = pickingListHtml([picking(order(ORDER_A, { shipping_address: address as Address | null }), true)], 'a5');
    const { left } = headParts(html);
    expect(left).toContain('Destination non renseignée');
    expect(left).not.toContain('class="pl-address"');
    expect(left).toContain('pl-mode">EXPÉDITION');
  }
});

test('picking header: pickup shows RETRAIT, no destination and no postal code', () => {
  for (const format of ['a5', 'a4'] as const) {
    const vm = picking(order(ORDER_A, { fulfillment_type: 'pickup' }), true);
    expect(vm.destinationParts).toBeNull();
    const { left } = headParts(pickingListHtml([vm], format));
    expect(left).not.toContain('75011');
    expect(left).not.toContain('pl-postal-city');
    expect(left).toContain('pl-mode">RETRAIT');
    expect(left).toContain('Awa Diallo');
  }
});

test('picking header: tenant logo top right with its aspect ratio, no frame; the tenant name replaces a missing or non-https logo', () => {
  const withLogo = buildPickingListViewModel({ order: order(ORDER_A), items: ITEMS, tenant: { name: 'Shop & Co', logo_url: 'https://cdn.example.com/logo.png' }, carton: null });
  for (const format of ['a5', 'a4'] as const) {
    const html = pickingListHtml([withLogo], format);
    const { left, right } = headParts(html);
    expect(right).toContain('<img class="pl-logo" src="https://cdn.example.com/logo.png" alt="Shop &amp; Co"');
    expect(left).not.toContain('Shop');
    expect(html).toContain(`.format-${format} .pl-logo { max-width:`);
    expect(html).toContain('.pl-logo { display: block; margin-left: auto; width: auto; height: auto; object-fit: contain; background: none; border: 0; padding: 0; }');
  }
  for (const logo_url of [null, '', 'http://insecure.example.com/l.png', 'javascript:alert(1)']) {
    const vm = buildPickingListViewModel({ order: order(ORDER_A), items: ITEMS, tenant: { name: 'Shop & Co', logo_url }, carton: null });
    const { right } = headParts(pickingListHtml([vm], 'a5'));
    expect(vm.logoUrl).toBeNull();
    expect(right).not.toContain('<img');
    expect(right).toContain('<span class="pl-brand">Shop &amp; Co</span>');
  }
});

test('picking header: bulk print keeps one header per order, no extra section', () => {
  const vms = [picking(order(ORDER_A)), picking(order(ORDER_B, { shipping_address: { postal_code: '00132', city: 'Roma', country: 'IT' } })), picking(order(ORDER_A, { fulfillment_type: 'pickup' }))];
  for (const format of ['a5', 'a4'] as const) {
    const html = pickingListHtml(vms, format);
    expect(html.match(/<section class="doc">/g)).toHaveLength(3);
    expect(html.match(/<div class="pl-head">/g)).toHaveLength(3);
    expect(html.match(/pl-postal-city">/g)).toHaveLength(2);
    expect(html.indexOf('75011')).toBeLessThan(html.indexOf('00132'));
    // Dernière section sans saut de page forcé (pas de feuille blanche finale).
    expect(html).toContain('.doc:last-child { break-after: auto;');
    // L'ancien bloc « Client / Résumé » A4 a disparu : le client est dans l'en-tête.
    expect(html).not.toContain('pl-grid2');
  }
});

test('punched margins: picking list only, centralised, applied by Gotenberg and footer aligned', () => {
  expect(documentMarginsMm('picking_list', 'a5')).toEqual({ top: 9, right: 9, bottom: 13, left: 22 });
  expect(documentMarginsMm('picking_list', 'a4')).toEqual({ top: 12, right: 14, bottom: 15, left: 25 });
  // Bon de colis et liste groupée : marges du format, inchangées.
  for (const kind of ['packing_slip', 'preparation_summary'] as const) {
    expect(documentMarginsMm(kind, 'a5')).toEqual({ top: 9, right: 9, bottom: 13, left: 9 });
    expect(documentMarginsMm(kind, 'a4')).toEqual({ top: 12, right: 14, bottom: 15, left: 14 });
  }
  const fields = Object.fromEntries(gotenbergOptionFields({ marginsMm: documentMarginsMm('picking_list', 'a5') }));
  expect(fields).toMatchObject({ marginLeft: '0.866', marginRight: '0.354' });
  expect(Object.fromEntries(gotenbergOptionFields({ marginsMm: documentMarginsMm('picking_list', 'a4') }))).toMatchObject({ marginLeft: '0.984', marginRight: '0.551' });
  // Marges Gotenberg uniquement : aucun padding CSS gauche dans le document.
  expect(pickingListHtml([picking(order(ORDER_A))], 'a5')).not.toMatch(/padding-left|margin-left: (?!auto)/);
  expect(documentFooterHtml('x', { left: 22, right: 9 })).toContain('padding-left: 22mm');
  expect(documentFooterHtml('x')).toContain('padding-left: 9mm');
});

test('French weekday starts with a capital; only the first letter changes, other dates untouched', () => {
  const days: Array<[string, string]> = [
    ['2026-11-02T09:00:00Z', 'Lundi'], ['2026-11-03T09:00:00Z', 'Mardi'], ['2026-11-04T09:00:00Z', 'Mercredi'],
    ['2026-11-05T09:14:00Z', 'Jeudi'], ['2026-11-06T09:00:00Z', 'Vendredi'], ['2026-11-07T09:00:00Z', 'Samedi'], ['2026-11-08T09:00:00Z', 'Dimanche'],
  ];
  for (const [iso, day] of days) expect(formatDocumentDate(iso, 'weekday')).toMatch(new RegExp(`^${day} \\d{2}/11/2026 · \\d{2}:\\d{2}$`));
  expect(formatDocumentDate('2026-11-05T09:14:00Z', 'weekday')).toBe('Jeudi 05/11/2026 · 10:14');
  expect(formatDocumentDate('2026-11-05T09:14:00Z', 'short')).toBe('05/11/2026 10:14');
  expect(formatDocumentDate('2026-11-05T09:14:00Z', 'long')).toBe('5 novembre 2026');
  expect(capitalizeFirst('élodie')).toBe('Élodie');
  expect(capitalizeFirst('')).toBe('');
  // Aucun text-transform indiscriminé dans le document.
  expect(pickingListHtml([picking(order(ORDER_A))], 'a5')).not.toContain('text-transform');
});

// ─── B. Récapitulatif client : format acheté ───────────────────────────────

const DOC_TENANT: DocumentTenant = {
  name: 'Chloe Food', logo_url: null, primary_color: '#0b3d91', currency: 'EUR', storefront_url: 'https://shop.example.com',
  whatsapp_number: null, legal_email: null, android_package_name: null, android_public: false,
};

const snap = (fields: Record<string, unknown>) => ({ v: 1, ...fields });

test('format label: structured grams/kilos, millilitres/litres, packs and sold by the kilo', () => {
  expect(orderItemFormatLabel(snap({ sale_unit: 'sachet', net_content_value: 150, net_content_unit: 'g' }), 'Kaolin')).toBe('150 g');
  expect(orderItemFormatLabel(snap({ net_content_value: '1000.000', net_content_unit: 'g', sale_unit: 'sac' }), 'Riz parfumé')).toBe('1 kg');
  expect(orderItemFormatLabel(snap({ net_content_value: 1.5, net_content_unit: 'kg', sale_unit: 'sac' }), 'Gari')).toBe('1,5 kg');
  expect(orderItemFormatLabel(snap({ sale_unit: 'bouteille', net_content_value: 500, net_content_unit: 'ml' }), 'Bissap')).toBe('500 ml');
  expect(orderItemFormatLabel(snap({ sale_unit: 'bouteille', net_content_value: 1, net_content_unit: 'l' }), 'Huile de palme')).toBe('1 L');
  expect(orderItemFormatLabel(snap({ sale_unit: 'carton', net_content_value: 33, net_content_unit: 'cl', pack_count: 12 }), 'Malta Guinness')).toBe('12 × 33 cl');
  expect(orderItemFormatLabel(snap({ sale_unit: 'kg' }), 'Viande de chèvre')).toBe('Vendu au kilo');
  // Quantité nette libre (018) : lue strictement, sinon telle quelle (texte court).
  expect(orderItemFormatLabel(snap({ net_quantity_display: '500 ml' }), 'Bissap')).toBe('500 ml');
  expect(orderItemFormatLabel(snap({ net_quantity_display: 'Sachet de 5 pièces' }), 'Plantain chips')).toBe('Sachet de 5 pièces');
  expect(orderItemFormatLabel(snap({ net_quantity_display: 'x'.repeat(41) }), 'Plantain chips')).toBeNull();
});

test('format label: never duplicated when the name already says it', () => {
  expect(orderItemFormatLabel(snap({ net_content_value: 150, net_content_unit: 'g' }), 'Kaolin 150g')).toBeNull();
  expect(orderItemFormatLabel(snap({ net_content_value: 500, net_content_unit: 'g' }), 'Kaolin 500 grammes')).toBeNull();
  expect(orderItemFormatLabel(snap({ net_content_value: 1000, net_content_unit: 'ml' }), 'Huile de palme 1 L')).toBeNull();
  expect(orderItemFormatLabel(snap({ net_content_value: 1, net_content_unit: 'kg' }), 'Gari 1000 g')).toBeNull();
  expect(orderItemFormatLabel(snap({ sale_unit: 'carton', net_content_value: 33, net_content_unit: 'cl', pack_count: 12 }), 'Malta 12 x 33 cl')).toBeNull();
  expect(orderItemFormatLabel(snap({ sale_unit: 'carton', net_content_value: 33, net_content_unit: 'cl', pack_count: 12 }), 'Malta 33 cl')).toBe('12 × 33 cl');
  expect(orderItemFormatLabel(snap({ net_quantity_display: 'Sachet de 5 pièces' }), 'Chips (sachet de 5 pièces)')).toBeNull();
  expect(orderItemFormatLabel(snap({ sale_unit: 'kg' }), 'Viande au kilo')).toBeNull();
  // Un autre poids dans le nom n'est pas le même format : affiché.
  expect(orderItemFormatLabel(snap({ net_content_value: 250, net_content_unit: 'g' }), 'Kaolin 500 g')).toBe('250 g');
});

test('format label: legacy lines and unreliable snapshots show nothing', () => {
  for (const raw of [undefined, null, {}, [], 'Format 500 g', { v: 2, net_content_value: 500, net_content_unit: 'g' }, snap({}), snap({ net_content_unit: 'g' }), snap({ sale_unit: 'inconnu' })]) {
    expect(orderItemFormatLabel(raw, 'Kaolin')).toBeNull();
  }
});

test('packing slip: format inline at 10 pt in A5, under the name in A4, escaped, prices unchanged', () => {
  const items = [
    item(ORDER_A, 'Kaolin', { format_snapshot: snap({ sale_unit: 'sachet', net_content_value: 150, net_content_unit: 'g' }), price: 4.5, quantity: 2, subtotal: 9 }),
    item(ORDER_A, 'Épices <maison>', { format_snapshot: snap({ net_quantity_display: 'Pot <b>"200"</b>' }), price: 3, quantity: 1, subtotal: 3 }),
    item(ORDER_A, 'Mitoumba', { price: 5, quantity: 1, subtotal: 5 }),
  ];
  const settings = { ...ORDER_DOCUMENTS_DEFAULTS, packing_slip_show_prices: true };
  const vm = buildPackingSlipViewModel({ order: order(ORDER_A), items, tenant: DOC_TENANT, settings, qr: null });
  expect(vm.items.map((i) => i.format)).toEqual(['150 g', 'Pot <b>"200"</b>', null]);
  expect(vm.items.map((i) => i.lineTotal?.replace(/\s/g, ' '))).toEqual(['9,00 €', '3,00 €', '5,00 €']);
  const legacy = buildPackingSlipViewModel({ order: order(ORDER_A), items: items.map(({ format_snapshot: _, ...rest }) => rest), tenant: DOC_TENANT, settings, qr: null });
  expect(legacy.items.map((i) => i.lineTotal)).toEqual(vm.items.map((i) => i.lineTotal));
  expect(legacy.prices).toEqual(vm.prices);
  // A4 : sous le nom ; A5 : à la suite du nom, insécable (pas de ligne en plus par article).
  const a4 = packingSlipHtml([vm], 'a4');
  expect(a4).toContain('<td>Kaolin<span class="ps-format">Format : 150 g</span></td>');
  expect(a4).toContain('Format : Pot &lt;b&gt;&quot;200&quot;&lt;/b&gt;');
  const a5 = packingSlipHtml([vm], 'a5');
  expect(a5).toContain('<td>Kaolin <span class="ps-format-inline">· 150 g</span></td>');
  expect(a5).toContain('· Pot &lt;b&gt;&quot;200&quot;&lt;/b&gt;');
  expect(a5).toContain('.ps-format-inline { color: #222; white-space: nowrap; }');
  for (const format of ['a5', 'a4'] as const) {
    const html = packingSlipHtml([vm], format);
    expect(html).not.toContain('<b>"200"</b>');
    expect(html).toContain('<td>Mitoumba</td>');
    // Pas de colonne supplémentaire : quantité, article, prix.
    expect(html.match(/<tr>[\s\S]*?<\/tr>/)?.[0].match(/<td/g)).toHaveLength(3);
    expect(packingSlipHtml([legacy], format)).not.toMatch(/ps-format(-inline)?"/);
  }
  expect(a5).toContain('.format-a5 .ps-url, .format-a5 .ps-contact, .format-a5 .ps-alt, .format-a5 .ps-format-inline { font-size: 10pt; }');
});

test('packing slip: assisted/manual lines without product use their own snapshot only', () => {
  const items = [
    item(ORDER_A, 'Colis surprise', { product_id: null, format_snapshot: snap({ net_quantity_display: '2 kg' }) }),
    item(ORDER_A, 'Article libre', { product_id: null }),
  ];
  const vm = buildPackingSlipViewModel({ order: order(ORDER_A), items, tenant: DOC_TENANT, settings: ORDER_DOCUMENTS_DEFAULTS, qr: null });
  expect(vm.items.map((i) => i.format)).toEqual(['2 kg', null]);
});

// ─── Chargement : snapshot historique, catalogue ignoré, isolation ─────────

function slipDb(): FakeDb {
  return fakeDb({
    platform_features: [{ key: 'order_documents' }],
    orders: [order(ORDER_A), { ...order(ORDER_OTHER_TENANT), tenant_id: TENANT_B }],
    order_items: [
      // Snapshot pris à l'achat (150 g) ; la fiche vaut maintenant 250 g.
      item(ORDER_A, 'Kaolin', { product_id: 'p-kaolin', format_snapshot: snap({ sale_unit: 'sachet', net_content_value: 150, net_content_unit: 'g' }) }),
      // Ligne antérieure à la 162 : le format actuel de la fiche n'est jamais utilisé.
      item(ORDER_A, 'Bissap', { product_id: 'p-bissap', format_snapshot: null }),
      { ...item(ORDER_OTHER_TENANT, 'Secret', { format_snapshot: snap({ net_quantity_display: 'Format secret' }) }), tenant_id: TENANT_B },
    ],
    products: [
      { id: 'p-kaolin', tenant_id: TENANT_A, name: 'Kaolin', sale_unit: 'sachet', net_content_value: 250, net_content_unit: 'g', weight_grams: 300 },
      { id: 'p-bissap', tenant_id: TENANT_A, name: 'Bissap', net_quantity_display: '1 L', weight_grams: 1100 },
    ],
    order_public_access_tokens: [],
  });
}

const TENANT = { id: TENANT_A, name: 'Chloe Food', logo_url: null, primary_color: '#0b3d91', currency: 'EUR', storefront_url: 'https://shop.example.com', whatsapp_number: null, legal_email: null, android_package_name: null, android_public: false } as unknown as Tenant;

async function renderSlip(db: FakeDb, orderIds: string[]): Promise<string> {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.GOTENBERG_URL;
  const calls: FormData[] = [];
  process.env.GOTENBERG_URL = 'http://gotenberg.test';
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => { calls.push(init?.body as FormData); return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }); }) as typeof fetch;
  try {
    await renderOrderDocuments({ db: db as never, tenant: TENANT, kind: 'packing_slip', format: 'a5', settings: ORDER_DOCUMENTS_DEFAULTS, bulk: orderIds.length > 1, orderIds });
    return (calls[0]!.get('files') as Blob).text();
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.GOTENBERG_URL; else process.env.GOTENBERG_URL = previousUrl;
  }
}

test('render: historical format printed even after the product changed; legacy lines never read the catalogue', async () => {
  const html = await renderSlip(slipDb(), [ORDER_A]);
  expect(html).toContain('· 150 g');
  expect(html).not.toContain('250 g');
  expect(html).toContain('<td>Bissap</td>');
  expect(html).not.toContain('1 L');
});

test('render: tenant isolation — another tenant\'s line and format never reach the document', async () => {
  const html = await renderSlip(slipDb(), [ORDER_A, ORDER_OTHER_TENANT]);
  expect(html).not.toContain('Secret');
  expect(html).not.toContain('Format secret');
  expect(html.match(/<section class="doc ps">/g)).toHaveLength(1);
});

test('loader: without migration 162 the slip is still printed, without format', async () => {
  const db = slipDb();
  const original = db.from.bind(db);
  const missing = { code: '42703', message: 'column order_items.format_snapshot does not exist' };
  const failing = {
    eq() { return failing; }, in() { return failing; },
    then(resolve: (value: { data: null; error: typeof missing }) => unknown) { return Promise.resolve({ data: null, error: missing }).then(resolve); },
  };
  const selects: string[] = [];
  db.from = (table: string) => {
    const query = original(table);
    if (table !== 'order_items') return query;
    const select = query.select.bind(query);
    (query as unknown as { select: (columns?: string) => unknown }).select = (columns?: string) => {
      selects.push(columns ?? '');
      return columns?.includes('format_snapshot') ? failing : select(columns);
    };
    return query;
  };
  const loaded = await loadOrderDocumentData(db as never, { tenantId: TENANT_A, orderIds: [ORDER_A], mode: 'packing' });
  expect(loaded.orders[0]!.items.map((i) => i.name)).toEqual(['Kaolin', 'Bissap']);
  // Première lecture avec le snapshot refusée, relecture avec les colonnes historiques.
  expect(selects).toHaveLength(2);
  expect(selects[0]).toContain('format_snapshot');
  expect(selects[1]).not.toContain('format_snapshot');
  const html = await renderSlip(db, [ORDER_A]);
  expect(html).toContain('RÉCAPITULATIF DE COMMANDE');
  // Picking : même lecture (snapshot puis repli), la liste reste imprimable sans la 162.
  selects.length = 0;
  const picking = await loadOrderDocumentData(db as never, { tenantId: TENANT_A, orderIds: [ORDER_A], mode: 'picking' });
  expect(picking.orders[0]!.items).toHaveLength(2);
  expect(selects).toHaveLength(2);
  expect(selects[0]).toContain('format_snapshot');
  expect(selects[1]).not.toContain('format_snapshot');
});

test('picking list: purchased format from the order line, catalogue weight only without snapshot, never both', () => {
  const weights = new Map([['p-Arachides frais', 1000], ['p-Mitoumba', 750], ['p-Kaolin 500 g', 500], ['p-Bissap', 300]]);
  const items: DocumentItemRow[] = [
    // Catalogue now says 1 kg, the customer bought what the line recorded.
    item(ORDER_A, 'Arachides frais', { format_snapshot: snap({ net_quantity_display: '2 kg' }) }),
    item(ORDER_A, 'Mitoumba', { format_snapshot: snap({ sale_unit: 'sachet', net_content_value: 150, net_content_unit: 'g' }) }),
    // Format already in the name: neither format nor weight.
    item(ORDER_A, 'Kaolin 500 g', { format_snapshot: snap({ net_quantity_display: '500 g' }) }),
    // Legacy line / product without format: catalogue weight fallback.
    item(ORDER_A, 'Bissap', { format_snapshot: null }),
    item(ORDER_A, 'Épices <maison>', { product_id: null, format_snapshot: snap({ net_quantity_display: 'Pot <b>"200"</b>' }) }),
  ];
  const vm = buildPickingListViewModel({ order: order(ORDER_A), items, tenant: { name: 'T' }, carton: null, productWeights: weights });
  const line = (name: string) => vm.items.find((i) => i.name === name)!;
  expect(line('Arachides frais')).toMatchObject({ format: '2 kg', catalogueWeight: null });
  expect(line('Mitoumba')).toMatchObject({ format: '150 g', catalogueWeight: null });
  expect(line('Kaolin 500 g')).toMatchObject({ format: null, catalogueWeight: null });
  expect(line('Bissap')).toMatchObject({ format: null, catalogueWeight: '300 g' });
  for (const format of ['a5', 'a4'] as const) {
    const html = pickingListHtml([vm], format);
    expect(html).toContain('Format : 2 kg');
    expect(html).toContain('Format : 150 g');
    expect(html).toContain('Poids catalogue : 300 g');
    expect(html).not.toContain('Poids catalogue : 1 kg');
    expect(html).not.toContain('Poids catalogue : 750 g');
    expect(html).toContain('Format : Pot &lt;b&gt;&quot;200&quot;&lt;/b&gt;');
    expect(html).not.toContain('<b>"200"</b>');
  }
});

// ─── C. Rifinitura UX : modalità accanto alla réf., footer, cartone, suivi ─────

test('picking header: fulfilment badge next to the order reference, country line carries no mode, stored mode untouched', () => {
  for (const format of ['a5', 'a4'] as const) {
    const ship = headParts(pickingListHtml([picking(order(ORDER_A), true)], format)).left;
    expect(ship).toContain('<span>Commande #163835B8</span><span class="pl-mode">EXPÉDITION</span>');
    expect(ship).toContain('<div class="pl-route">France</div>');
    expect(ship).not.toContain('LIVRAISON');
    const pickup = headParts(pickingListHtml([picking(order(ORDER_A, { fulfillment_type: 'pickup' }), true)], format)).left;
    expect(pickup).toContain('<span>Commande #163835B8</span><span class="pl-mode">RETRAIT</span>');
    expect(pickup).not.toContain('pl-route');
  }
  // Badge lisible en noir et blanc : cadre fin, pas de fond sombre.
  const css = pickingListHtml([picking(order(ORDER_A))], 'a5');
  const modeRule = /\.pl-mode \{[^}]*\}/.exec(css)![0];
  expect(modeRule).toContain('border: 0.35mm solid #111');
  expect(modeRule).toContain('white-space: nowrap');
  expect(modeRule).not.toContain('background');
  // Seule l'étiquette imprimée change : le mode du view-model et les autres libellés restent.
  const vm = picking(order(ORDER_A));
  expect(vm.fulfillment).toBe('delivery');
  expect(vm.fulfillmentLabel).toBe('LIVRAISON');
  expect(vm.fulfillmentBadge).toBe('EXPÉDITION');
  expect(pickingListHtml([vm], 'a5')).toContain('COÛT LIVRAISON');
});

test('footer: label left and page number right, truly separated, aligned on the punched margin', () => {
  const html = documentFooterHtml('#BAB5D42F · Liste de préparation', { left: 22, right: 9 });
  expect(html).toContain('<td class="l">#BAB5D42F · Liste de préparation</td>');
  expect(html).toContain('<td class="r">Page <span class="pageNumber"></span>/<span class="totalPages"></span></td>');
  expect(html).toContain('td.l { text-align: left; padding-left: 22mm; padding-right: 6mm; }');
  expect(html).toContain('td.r { text-align: right; padding-right: 9mm; white-space: nowrap;');
  expect(html).not.toContain('display: flex');
  expect(documentFooterHtml('x', { left: 25, right: 14 })).toContain('padding-left: 25mm');
});

test('packaging block: dimensions never split from their unit, weight kept with them, long names wrap before the group', () => {
  const cartons = {
    lines: [{ count: 1, name: 'Carton S commerce', dimensions: '35 × 25 × 22 cm', weights: '1,58 kg' }, { count: 2, name: 'Grand carton', dimensions: '60 × 40 × 40 cm', weights: '19,5 kg + 18,25 kg' }],
    parcels: [{ index: 1, weight: '1,58 kg', carton: 'Carton S commerce', dimensions: '35 × 25 × 22 cm' }],
    alternatives: [], totalWeight: '1,58 kg', maxParcelNote: null,
  };
  const vm = { ...picking(order(ORDER_A)), cartons };
  const a5 = pickingListHtml([vm], 'a5');
  expect(a5).toContain('<span class="pl-nb">35 × 25 × 22 cm · 1,58 kg</span>');
  expect(a5).toContain('<span class="pl-nb">60 × 40 × 40 cm</span> · <span class="pl-nb">19,5 kg</span> + <span class="pl-nb">18,25 kg</span>');
  expect(a5).toContain('.pl-nb { white-space: nowrap; }');
  expect(a5).toContain('.pl-shipping-grid .pl-carton { overflow-wrap: anywhere; }');
  expect(a5).toContain('COÛT LIVRAISON');
  const a4 = pickingListHtml([vm], 'a4');
  expect(a4).toContain('<span class="pl-nb">35 × 25 × 22 cm</span>');
});

test('follow-up block: more room for handwriting with fixed, content-independent heights', () => {
  const a5 = pickingListHtml([picking(order(ORDER_A))], 'a5');
  const a4 = pickingListHtml([picking(order(ORDER_A))], 'a4');
  expect(a5).toContain('.format-a5 .pl-follow-row { min-height: 7.5mm; }');
  expect(a5).toContain('.format-a5 .pl-follow-line { height: 6.5mm; }');
  expect(a5).toContain('.format-a5 .pl-follow-sign span { padding-bottom: 5mm; }');
  expect(a4).toContain('.pl-follow-row { min-height: 10mm; }');
  expect(a4).toContain('.pl-follow-line { display: block; height: 8mm;');
  expect(a4).toContain('.pl-follow-sign span { padding-bottom: 7mm; }');
  // Le bloc reste insécable et ne dépend pas de l'espace restant de la page.
  expect(a5).toContain('.pl-follow { break-inside: avoid;');
  expect(a5).not.toMatch(/\.pl-follow[^{]*\{[^}]*(vh|calc\(|flex-grow|height: 100%)/);
  expect(a5).toContain('.pl-follow-check { display: inline-block; width: 5mm; height: 5mm;');
});

test('packing slip is not touched by the picking-list polish', () => {
  const slip = packingSlipHtml([buildPackingSlipViewModel({ order: order(ORDER_A), items: ITEMS, tenant: DOC_TENANT, settings: ORDER_DOCUMENTS_DEFAULTS, qr: null })], 'a5');
  expect(slip).not.toContain('pl-mode');
  expect(slip).not.toContain('EXPÉDITION');
  expect(slip).not.toContain('pl-nb');
});
