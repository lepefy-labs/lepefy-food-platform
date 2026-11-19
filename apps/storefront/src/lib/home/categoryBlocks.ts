/**
 * Category blocks of /accueil from ONE light list of active products
 * (`id, category_id`, ordered by `position`), instead of two queries per
 * category: per-category totals, the active product count and the first
 * products of each block (featured products excluded from the blocks only).
 */
export type CategoryBlockRow = { id: string; category_id: string | null };

export type CategoryBlockPlan = {
  activeCount: number;
  counts: Record<string, number>;
  idsByCategory: Record<string, string[]>;
  ids: string[];
};

export function planCategoryBlocks(
  rows: readonly CategoryBlockRow[],
  categoryIds: readonly string[],
  excludedIds: readonly string[],
  perCategory: number,
): CategoryBlockPlan {
  const wanted = new Set(categoryIds);
  const excluded = new Set(excludedIds);
  const counts: Record<string, number> = {};
  const idsByCategory: Record<string, string[]> = {};
  for (const categoryId of categoryIds) { counts[categoryId] = 0; idsByCategory[categoryId] = []; }
  for (const row of rows) {
    if (!row.category_id || !wanted.has(row.category_id)) continue;
    counts[row.category_id] = (counts[row.category_id] ?? 0) + 1;
    const ids = idsByCategory[row.category_id];
    if (ids && ids.length < perCategory && !excluded.has(row.id)) ids.push(row.id);
  }
  return { activeCount: rows.length, counts, idsByCategory, ids: Object.values(idsByCategory).flat() };
}
