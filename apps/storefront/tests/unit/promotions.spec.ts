import { test, expect } from '@playwright/test';
import {
  getActivePromotions,
  hasValidPromotion,
  isActivePromotion,
  promotionDiscountPercent,
  PROMOTIONS_QUERY_LIMIT,
  selectActivePromotions,
  type PromotionCandidate,
} from '../../src/lib/catalog/promotions';

const row = (id: string, price: number, compareAt: number | null, extra: Partial<PromotionCandidate> = {}): PromotionCandidate => ({
  id, price, compare_at_price: compareAt, stock: 20, min_order_quantity: 1, order_quantity_step: 1, ...extra,
});

/** Double du builder PostgREST : enregistre chaque filtre et répond avec `rows`. */
function fakeSupabase(rows: Array<PromotionCandidate & { tenant_id: string; active: boolean; category_id: string }>, error: { message: string } | null = null) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder = {
    select: (columns: string) => { calls.push(['select', columns]); return builder; },
    eq: (column: string, value: unknown) => { calls.push(['eq', column, value]); return builder; },
    in: (column: string, values: unknown[]) => { calls.push(['in', column, values]); return builder; },
    not: (column: string, op: string, value: unknown) => { calls.push(['not', column, op, value]); return builder; },
    order: (column: string) => { calls.push(['order', column]); return builder; },
    limit: async (count: number) => {
      calls.push(['limit', count]);
      if (error) return { data: null, error };
      // Applique les filtres comme le ferait PostgREST.
      const eqs = calls.filter((c) => c[0] === 'eq') as Array<['eq', string, unknown]>;
      const ins = calls.filter((c) => c[0] === 'in') as Array<['in', string, unknown[]]>;
      const data = rows.filter((r) => eqs.every(([, col, v]) => (r as unknown as Record<string, unknown>)[col] === v)
        && ins.every(([, col, vs]) => vs.includes((r as unknown as Record<string, unknown>)[col]))
        && r.compare_at_price != null);
      return { data, error: null };
    },
  };
  return { client: { from: (table: string) => { calls.push(['from', table]); return builder; } }, calls };
}

test.describe('Règle de promotion (prix barré existant)', () => {
  test('active : prix barré strictement supérieur au prix', () => {
    expect(hasValidPromotion({ price: 25.9, compare_at_price: 30 })).toBe(true);
    expect(promotionDiscountPercent({ price: 25.9, compare_at_price: 30 })).toBe(14);
    expect(promotionDiscountPercent({ price: 45.9, compare_at_price: 59.9 })).toBe(23);
  });

  test('terminée ou absente : prix barré retiré, égal ou inférieur au prix', () => {
    expect(hasValidPromotion({ price: 5, compare_at_price: null })).toBe(false);
    expect(hasValidPromotion({ price: 5, compare_at_price: 5 })).toBe(false);
    expect(hasValidPromotion({ price: 5, compare_at_price: 4 })).toBe(false);
    expect(hasValidPromotion({ price: 0, compare_at_price: 4 })).toBe(false);
    expect(promotionDiscountPercent({ price: 5, compare_at_price: null })).toBeNull();
  });

  test('un produit indisponible n’est jamais une promotion achetable', () => {
    expect(isActivePromotion(row('a', 5, 7))).toBe(true);
    expect(isActivePromotion(row('b', 5, 7, { stock: 0 }))).toBe(false);
    // Stock 8 pour un minimum de 12 : pas achetable.
    expect(isActivePromotion(row('c', 5, 7, { stock: 8, min_order_quantity: 12, order_quantity_step: 6 }))).toBe(false);
    // Stock inconnu = non limité (même convention que deriveAvailability).
    expect(isActivePromotion(row('d', 5, 7, { stock: null }))).toBe(true);
  });

  test('tri : plus forte remise d’abord, ordre catalogue à remise égale, sans doublon', () => {
    const rows = [row('small', 9, 10), row('none', 5, null), row('big', 5, 10), row('same', 18, 20), row('big', 5, 10)];
    expect(selectActivePromotions(rows).map((r) => r.id)).toEqual(['big', 'small', 'same']);
    expect(selectActivePromotions([])).toEqual([]);
  });
});

test.describe('Lecture des promotions par tenant', () => {
  const rows = [
    { ...row('t1-promo', 5, 7), tenant_id: 'tenant-1', active: true, category_id: 'cat-shop' },
    { ...row('t1-inactive', 5, 7), tenant_id: 'tenant-1', active: false, category_id: 'cat-shop' },
    { ...row('t1-goodies', 5, 7), tenant_id: 'tenant-1', active: true, category_id: 'cat-goodies' },
    { ...row('t1-expired', 5, 5), tenant_id: 'tenant-1', active: true, category_id: 'cat-shop' },
    { ...row('t1-soldout', 5, 9, { stock: 0 }), tenant_id: 'tenant-1', active: true, category_id: 'cat-shop' },
    { ...row('t2-promo', 1, 9), tenant_id: 'tenant-2', active: true, category_id: 'cat-shop' },
  ];

  test('filtre toujours tenant, actif, catégories boutique et prix barré présent', async () => {
    const { client, calls } = fakeSupabase(rows);
    const result = await getActivePromotions(client as never, 'tenant-1', ['cat-shop']);
    expect(result.map((r) => r.id)).toEqual(['t1-promo']);
    expect(calls).toContainEqual(['from', 'products']);
    expect(calls).toContainEqual(['eq', 'tenant_id', 'tenant-1']);
    expect(calls).toContainEqual(['eq', 'active', true]);
    expect(calls).toContainEqual(['in', 'category_id', ['cat-shop']]);
    expect(calls).toContainEqual(['not', 'compare_at_price', 'is', null]);
    expect(calls).toContainEqual(['limit', PROMOTIONS_QUERY_LIMIT]);
  });

  test('isolation : les promotions d’un tenant ne sortent jamais pour un autre', async () => {
    const { client } = fakeSupabase(rows);
    expect((await getActivePromotions(client as never, 'tenant-2', ['cat-shop'])).map((r) => r.id)).toEqual(['t2-promo']);
    expect(await getActivePromotions(client as never, 'tenant-3', ['cat-shop'])).toEqual([]);
  });

  test('aucune catégorie, aucun tenant ou lecture en échec : aucune promotion, jamais d’erreur', async () => {
    const { client, calls } = fakeSupabase(rows);
    expect(await getActivePromotions(client as never, 'tenant-1', [])).toEqual([]);
    expect(await getActivePromotions(client as never, '', ['cat-shop'])).toEqual([]);
    expect(calls).toHaveLength(0);
    const failing = fakeSupabase(rows, { message: 'boom' });
    const originalError = console.error;
    console.error = () => {};
    try {
      expect(await getActivePromotions(failing.client as never, 'tenant-1', ['cat-shop'])).toEqual([]);
    } finally {
      console.error = originalError;
    }
  });
});
