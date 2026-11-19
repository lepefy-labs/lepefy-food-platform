import { expect, test } from '@playwright/test';
import { planCategoryBlocks } from '@/lib/home/categoryBlocks';

test.describe('/accueil category blocks from one light product list', () => {
  const rows = [
    { id: 'a1', category_id: 'A' }, { id: 'a2', category_id: 'A' }, { id: 'b1', category_id: 'B' },
    { id: 'a3', category_id: 'A' }, { id: 'x1', category_id: null }, { id: 'a4', category_id: 'A' },
    { id: 'a5', category_id: 'A' }, { id: 'z1', category_id: 'Z' }, { id: 'a6', category_id: 'A' },
  ];

  test('keeps catalogue order, skips featured products in blocks but counts them', () => {
    const plan = planCategoryBlocks(rows, ['A', 'B', 'C'], ['a2'], 4);
    expect(plan.idsByCategory).toEqual({ A: ['a1', 'a3', 'a4', 'a5'], B: ['b1'], C: [] });
    expect(plan.counts).toEqual({ A: 6, B: 1, C: 0 });
    expect(plan.ids).toEqual(['a1', 'a3', 'a4', 'a5', 'b1']);
  });

  test('the active count covers every active product, categorised or not', () => {
    expect(planCategoryBlocks(rows, ['A'], [], 4).activeCount).toBe(9);
    expect(planCategoryBlocks([], ['A'], [], 4)).toEqual({ activeCount: 0, counts: { A: 0 }, idsByCategory: { A: [] }, ids: [] });
  });
});
