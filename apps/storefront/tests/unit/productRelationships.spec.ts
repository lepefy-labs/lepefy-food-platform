import { expect, test } from '@playwright/test';
import {
  orderExplicitRelationships,
  selectSemanticRelationshipCandidates,
  validateProductRelationshipProducts,
} from '../../src/lib/catalog/productRelationships';
import { inferNalaRelationshipType } from '../../src/lib/ai/nalaRelationshipIntent';
import {
  buildValidatedNalaProductActions,
  type NalaCanonicalProduct,
} from '../../src/lib/ai/nalaProductActionContract';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const SOURCE = '33333333-3333-4333-8333-333333333333';
const TARGET_A = '44444444-4444-4444-8444-444444444444';
const TARGET_B = '55555555-5555-4555-8555-555555555555';
const INTERACTION = '66666666-6666-4666-8666-666666666666';

test('same tenant è valido; cross tenant e self relation sono rifiutati', async () => {
  expect(validateProductRelationshipProducts({
    tenantId: TENANT,
    sourceProductId: SOURCE,
    targetProductId: TARGET_A,
    sourceTenantId: TENANT,
    targetTenantId: TENANT,
    relationshipType: 'similar',
  })).toEqual({ valid: true });

  expect(validateProductRelationshipProducts({
    tenantId: TENANT,
    sourceProductId: SOURCE,
    targetProductId: TARGET_A,
    sourceTenantId: TENANT,
    targetTenantId: OTHER_TENANT,
    relationshipType: 'substitute',
  })).toEqual({ valid: false, reason: 'wrong_tenant' });

  expect(validateProductRelationshipProducts({
    tenantId: TENANT,
    sourceProductId: SOURCE,
    targetProductId: SOURCE,
    sourceTenantId: TENANT,
    targetTenantId: TENANT,
    relationshipType: 'complementary',
  })).toEqual({ valid: false, reason: 'self_relation' });
});

test('manual precede system e la priorità più alta viene prima', async () => {
  const rows = orderExplicitRelationships([
    { id: 'system', source: 'system' as const, priority: 999 },
    { id: 'manual-low', source: 'manual' as const, priority: 10 },
    { id: 'manual-high', source: 'manual' as const, priority: 30 },
  ]);
  expect(rows.map((row) => row.id)).toEqual(['manual-high', 'manual-low', 'system']);
});

test('similar fallback preferisce la categoria; substitute è conservativo', async () => {
  const candidates = [
    { id: TARGET_A, category_id: 'cat-a', similarity: 0.76 },
    { id: TARGET_B, category_id: 'cat-b', similarity: 0.95 },
  ];

  expect(selectSemanticRelationshipCandidates({
    type: 'similar',
    sourceProductId: SOURCE,
    sourceCategoryId: 'cat-a',
    excludedIds: [],
    candidates,
    limit: 2,
  }).map((item) => item.id)).toEqual([TARGET_A, TARGET_B]);

  expect(selectSemanticRelationshipCandidates({
    type: 'substitute',
    sourceProductId: SOURCE,
    sourceCategoryId: 'cat-a',
    excludedIds: [],
    candidates,
    limit: 2,
  }).map((item) => item.id)).toEqual([TARGET_A]);

  expect(selectSemanticRelationshipCandidates({
    type: 'complementary',
    sourceProductId: SOURCE,
    sourceCategoryId: 'cat-a',
    excludedIds: [],
    candidates,
    limit: 2,
  })).toEqual([]);
});

test('guard conversazionale distingue similar, substitute e complementary', async () => {
  expect(inferNalaRelationshipType('Vous avez quelque chose de similaire ?', { id: SOURCE, stock: 2 }))
    .toBe('similar');
  expect(inferNalaRelationshipType('Je cherche une alternative', { id: SOURCE, stock: 2 }))
    .toBe('substitute');
  expect(inferNalaRelationshipType('Avec quoi je peux manger ça ?', { id: SOURCE, stock: 2 }))
    .toBe('complementary');
  expect(inferNalaRelationshipType('Avez-vous ce produit ?', { id: SOURCE, stock: 0 }))
    .toBe('substitute');
  expect(inferNalaRelationshipType('Avez-vous ce produit ?', { id: SOURCE, stock: 4 }))
    .toBeNull();
});

function canonical(id: string, stock = 5): NalaCanonicalProduct {
  return {
    id,
    tenant_id: TENANT,
    name: id === TARGET_A ? 'Alternative A' : 'Alternative B',
    slug: id === TARGET_A ? 'alternative-a' : 'alternative-b',
    image_url: null,
    price: 4.5,
    compare_at_price: null,
    stock,
    active: true,
    weight_grams: 500,
    storage_type: 'dry',
  };
}

test('target substitute indisponibile è escluso e il limite action resta uno', async () => {
  expect(buildValidatedNalaProductActions({
    tenantId: TENANT,
    interactionId: INTERACTION,
    currency: 'EUR',
    locale: 'fr',
    candidates: [{ id: TARGET_A, relationshipType: 'substitute' }],
    products: [canonical(TARGET_A, 0)],
  })).toEqual([]);

  const actions = buildValidatedNalaProductActions({
    tenantId: TENANT,
    interactionId: INTERACTION,
    currency: 'EUR',
    locale: 'fr',
    candidates: [
      { id: TARGET_A, relationshipType: 'complementary' },
      { id: TARGET_B, relationshipType: 'complementary' },
    ],
    products: [canonical(TARGET_A), canonical(TARGET_B)],
  });
  expect(actions).toHaveLength(1);
  expect(actions[0]?.product.id).toBe(TARGET_A);
  expect(actions[0]?.relationshipType).toBe('complementary');
});
