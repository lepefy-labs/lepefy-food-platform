import { expect, test } from '@playwright/test';
import {
  buildValidatedNalaProductActions,
  getNalaProductActionCopy,
  performNalaAddOnce,
  shouldOfferNalaProductAction,
  toNalaCartProduct,
  type NalaCanonicalProduct,
} from '../../src/lib/ai/nalaProductActionContract';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const INTERACTION = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '44444444-4444-4444-8444-444444444444';

function product(overrides: Partial<NalaCanonicalProduct> = {}): NalaCanonicalProduct {
  return {
    id: PRODUCT,
    tenant_id: TENANT,
    name: 'Feuilles de ndolé avec un nom particulièrement long',
    slug: 'feuilles-ndole',
    image_url: null,
    price: 4.9,
    compare_at_price: 5.9,
    stock: 12,
    active: true,
    weight_grams: 500,
    storage_type: 'fresh',
    ...overrides,
  };
}

function build(products: NalaCanonicalProduct[]) {
  return buildValidatedNalaProductActions({
    tenantId: TENANT,
    interactionId: INTERACTION,
    currency: 'eur',
    locale: 'fr-FR',
    candidates: [{ id: PRODUCT, similarity: 0.82 }],
    products,
  });
}

test('un match canonico, tenant-safe e disponible produit une action', async () => {
  const actions = build([product()]);
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({
    action: 'add_to_cart',
    interactionId: INTERACTION,
    product: { id: PRODUCT, available: true, stock: 12, currency: 'EUR' },
  });
});

test('cross-tenant, inactive, out-of-stock e match debole non producono action', async () => {
  expect(build([product({ tenant_id: OTHER_TENANT })])).toEqual([]);
  expect(build([product({ active: false })])).toEqual([]);
  expect(build([product({ stock: 0 })])).toEqual([]);
  expect(buildValidatedNalaProductActions({
    tenantId: TENANT,
    interactionId: INTERACTION,
    currency: 'EUR',
    locale: 'fr',
    candidates: [{ id: PRODUCT, similarity: 0.31 }],
    products: [product()],
  })).toEqual([]);
});

test('small talk e domande operative non mostrano product action', async () => {
  expect(shouldOfferNalaProductAction('Bonjour !')).toBe(false);
  expect(shouldOfferNalaProductAction('Quels sont vos horaires ?')).toBe(false);
  expect(shouldOfferNalaProductAction('Quels moyens de paiement acceptez-vous ?')).toBe(false);
  expect(shouldOfferNalaProductAction('Où en est ma commande ?')).toBe(false);
  expect(shouldOfferNalaProductAction('Avez-vous du ndolé ?')).toBe(true);
});

test('la mappatura usa il contratto cart reale e mantiene l’interaction', async () => {
  const [action] = build([product()]);
  expect(action).toBeTruthy();
  expect(toNalaCartProduct(action!)).toEqual({
    id: PRODUCT,
    name: product().name,
    slug: 'feuilles-ndole',
    price: 4.9,
    image_url: null,
    weight_grams: 500,
    stock: 12,
    storage_type: 'fresh',
  });
  expect(action!.interactionId).toBe(INTERACTION);
});

test('il guard asincrono impedisce il doppio add e rende disponibile lo stato success', async () => {
  const inFlight = new Set<string>();
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });

  const first = performNalaAddOnce(inFlight, PRODUCT, async () => {
    calls += 1;
    await pending;
  });
  const second = await performNalaAddOnce(inFlight, PRODUCT, () => { calls += 1; });

  expect(second).toBe(false);
  expect(calls).toBe(1);
  release();
  expect(await first).toBe(true);
  expect(getNalaProductActionCopy('fr').labels).toMatchObject({
    added: '✓ Ajouté au panier',
    viewCart: 'Voir mon panier',
  });
});
