import { expect, test } from '@playwright/test';
import {
  finalizeNalaCartPlan,
  getNalaCartPlanCopy,
  isNalaCartBuilderAffirmative,
  isNalaCartBuilderIntent,
  normalizeNalaCartPlanExtraction,
  performNalaBulkAdd,
  selectNalaCartPlanItem,
  type NalaCartPlanItem,
} from '../../src/lib/ai/nalaCartPlanContract';
import type { NalaCanonicalProduct } from '../../src/lib/ai/nalaProductActionContract';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const INTERACTION = '33333333-3333-4333-8333-333333333333';
const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRODUCT_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PRODUCT_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function product(
  id: string,
  overrides: Partial<NalaCanonicalProduct> = {},
): NalaCanonicalProduct {
  return {
    id,
    tenant_id: TENANT,
    name: id === PRODUCT_A ? 'Feuilles de ndolé' : 'Épinards',
    slug: id === PRODUCT_A ? 'feuilles-ndole' : 'epinards',
    image_url: null,
    price: id === PRODUCT_A ? 4.9 : 3.2,
    compare_at_price: null,
    stock: 10,
    active: true,
    weight_grams: 500,
    storage_type: 'fresh',
    ...overrides,
  };
}

const ingredient = { name: 'feuilles de ndolé', required: true, quantityHint: null };

test('recipe intent propone un piano, mentre una query prodotto resta nel flusso normale', async () => {
  expect(isNalaCartBuilderIntent('Je veux cuisiner du ndolé')).toBe(true);
  expect(isNalaCartBuilderIntent('Que faut-il pour faire un mafé ?')).toBe(true);
  expect(isNalaCartBuilderIntent('Avez-vous du ndolé ?')).toBe(false);
  expect(isNalaCartBuilderIntent('Combien coûte ce produit ?')).toBe(false);
});

test('l’estrazione è bounded, deduplicata e ignorata fuori dal recipe intent', async () => {
  const raw = {
    type: 'recipe',
    title: 'Ndolé',
    ingredients: Array.from({ length: 10 }, (_, index) => ({
      name: index === 1 ? 'ingredient 0' : `ingredient ${index}`,
      required: index < 5,
      quantityHint: null,
    })),
  };
  expect(normalizeNalaCartPlanExtraction(raw, true)?.ingredients).toHaveLength(8);
  expect(normalizeNalaCartPlanExtraction(raw, false)).toBeNull();
});

test('un ingrediente usa soltanto un prodotto canonico tenant-safe e disponibile', async () => {
  const matched = selectNalaCartPlanItem({
    tenantId: TENANT,
    ingredient,
    currency: 'eur',
    directCandidates: [{ product: product(PRODUCT_A), similarity: 0.91 }],
  });
  expect(matched).toMatchObject({
    status: 'matched',
    source: 'direct',
    selectedByDefault: true,
    product: { id: PRODUCT_A, currency: 'EUR' },
  });

  const rejected = selectNalaCartPlanItem({
    tenantId: TENANT,
    ingredient,
    currency: 'EUR',
    directCandidates: [{
      product: product(PRODUCT_A, { tenant_id: OTHER_TENANT }),
      similarity: 0.99,
    }],
  });
  expect(rejected.status).toBe('unavailable');
});

test('un direct non disponibile usa il substitute esplicito e lo segnala', async () => {
  const item = selectNalaCartPlanItem({
    tenantId: TENANT,
    ingredient,
    currency: 'EUR',
    directCandidates: [{
      product: product(PRODUCT_A, { stock: 0 }),
      similarity: 0.93,
    }],
    substitute: {
      product: {
        id: PRODUCT_B,
        tenantId: TENANT,
        name: 'Épinards',
        slug: 'epinards',
        imageUrl: null,
        price: 3.2,
        stock: 7,
        active: true,
        weightGrams: 500,
        storageType: 'fresh',
      },
      source: 'manual',
      similarity: null,
    },
  });
  expect(item).toMatchObject({
    status: 'substitute',
    source: 'manual',
    selectedByDefault: true,
    product: { id: PRODUCT_B },
  });
});

test('nessun match sicuro produce unavailable senza riempimento vago', async () => {
  const item = selectNalaCartPlanItem({
    tenantId: TENANT,
    ingredient,
    currency: 'EUR',
    directCandidates: [{ product: product(PRODUCT_A), similarity: 0.41 }],
  });
  expect(item).toEqual({
    ingredientName: ingredient.name,
    required: true,
    status: 'unavailable',
    source: null,
    confidence: null,
    selectedByDefault: false,
    quantity: 1,
  });
});

function planItems(): NalaCartPlanItem[] {
  return [PRODUCT_A, PRODUCT_B, PRODUCT_C, PRODUCT_D].map((id) => ({
    ingredientName: product(id).name,
    required: true,
    status: 'matched' as const,
    source: 'direct' as const,
    confidence: 0.9,
    selectedByDefault: true,
    product: {
      id,
      name: product(id).name,
      slug: product(id).slug,
      imageUrl: null,
      price: product(id).price,
      currency: 'EUR',
      stock: 10,
      weightGrams: 500,
      storageType: 'fresh' as const,
    },
    quantity: 1 as const,
  }));
}

test('bulk confirmation aggiunge solo i selezionati e non duplica al doppio click', async () => {
  const items = planItems();
  const inFlight = new Set<string>();
  const calls: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });

  const first = performNalaBulkAdd({
    inFlight,
    planId: 'plan-1',
    items,
    selectedIds: new Set([PRODUCT_A, PRODUCT_B, PRODUCT_C, PRODUCT_D]),
    addItem: async (item) => {
      calls.push(item.product!.id);
      await pending;
    },
  });
  const duplicate = await performNalaBulkAdd({
    inFlight,
    planId: 'plan-1',
    items,
    selectedIds: new Set([PRODUCT_A, PRODUCT_B, PRODUCT_C, PRODUCT_D]),
    addItem: () => undefined,
  });

  expect(duplicate).toBeNull();
  expect(calls).toEqual([PRODUCT_A]);
  release();
  expect(await first).toEqual({
    addedIds: [PRODUCT_A, PRODUCT_B, PRODUCT_C, PRODUCT_D],
    failedIds: [],
  });
  expect(calls).toEqual([PRODUCT_A, PRODUCT_B, PRODUCT_C, PRODUCT_D]);
});

test('un prodotto deselezionato non viene aggiunto', async () => {
  const calls: string[] = [];
  await performNalaBulkAdd({
    inFlight: new Set(),
    planId: 'plan-deselected',
    items: planItems(),
    selectedIds: new Set([PRODUCT_A, PRODUCT_B, PRODUCT_C]),
    addItem: (item) => { calls.push(item.product!.id); },
  });
  expect(calls).toEqual([PRODUCT_A, PRODUCT_B, PRODUCT_C]);
});

test('il bulk add mantiene i successi e riporta il fallimento parziale', async () => {
  const result = await performNalaBulkAdd({
    inFlight: new Set(),
    planId: 'plan-2',
    items: planItems(),
    selectedIds: new Set([PRODUCT_A, PRODUCT_B, PRODUCT_C, PRODUCT_D]),
    addItem: (item) => {
      if (item.product?.id === PRODUCT_B) throw new Error('failed');
    },
  });
  expect(result).toEqual({
    addedIds: [PRODUCT_A, PRODUCT_C, PRODUCT_D],
    failedIds: [PRODUCT_B],
  });
});

test('follow-up Oui è limitato all’ultima proposta e il contratto calcola il subtotal', async () => {
  expect(isNalaCartBuilderAffirmative('Oui')).toBe(true);
  expect(isNalaCartBuilderAffirmative('Oui, avez-vous du manioc ?')).toBe(false);

  const plan = finalizeNalaCartPlan({
    id: 'plan',
    interactionId: INTERACTION,
    title: 'Ndolé',
    items: planItems(),
    currency: 'eur',
    locale: 'fr',
  });
  expect(plan.totals).toEqual({
    availableItems: 4,
    unavailableItems: 0,
    subtotal: 14.5,
  });
});

test('la copy Cart Builder segue storefront FR anche con browser IT', async () => {
  expect(getNalaCartPlanCopy('fr').prepare).toBe('Préparer mon panier');
  expect(getNalaCartPlanCopy('fr').substitute).toBe('Alternative proposée');
  expect(getNalaCartPlanCopy('it').prepare).toBe('Prepara il mio carrello');
  expect(getNalaCartPlanCopy('en').prepare).toBe('Prepare my cart');
  expect(getNalaCartPlanCopy('xx').prepare).toBe('Préparer mon panier');
});
