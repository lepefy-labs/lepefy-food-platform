import type { SupabaseClient } from '@supabase/supabase-js';
import { applyCatalogueStatus, CATALOGUE_HIGHLIGHT_OPTIONS, CATALOGUE_ISSUE_OPTIONS, CATALOGUE_VIEW_OPTIONS, type CatalogueListState, type CatalogueStatus } from './catalogueFilters';

export const CATALOGUE_PAGE_SIZE = 25;

const SORT_MAP: Record<string, { column: string; ascending: boolean }> = {
  position_asc: { column: 'position', ascending: true },
  name_asc: { column: 'name', ascending: true },
  name_desc: { column: 'name', ascending: false },
  price_asc: { column: 'price', ascending: true },
  price_desc: { column: 'price', ascending: false },
  stock_asc: { column: 'stock', ascending: true },
  stock_desc: { column: 'stock', ascending: false },
};

export interface CatalogueListProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  stock: number;
  active: boolean;
  weight_grams: number | null;
  category_id: string | null;
  image_url: string | null;
  storage_type: string | null;
  fulfillment_policy: string | null;
  warehouse_location: string | null;
  description_source: 'ai' | 'human' | null;
  barcode_value: string | null;
  /** Format affiché (« 500 g ») : aperçu du sélecteur de duplication. */
  net_quantity_display: string | null;
  // Mise en avant (migration 156).
  compare_at_price: number | null;
  promo_price: number | null;
  promo_applied: boolean;
  promo_ends_at: string | null;
  new_until: string | null;
  categories: { name: string; slug: string } | null;
}

export interface CatalogueListResult {
  products: CatalogueListProduct[];
  total: number;
  page: number;
  limit: number;
  /**
   * Faceted counters (null when a count failed): each one applies every filter
   * of the list except its own dimension (view, highlight or issue).
   */
  counts: Partial<Record<CatalogueStatus, number | null>>;
  /** Products per category_id ('' = sans catégorie) with every filter but the category; null when unavailable. */
  categoryCounts: Record<string, number> | null;
  /** Whole catalogue, no filter (page header). */
  catalogueTotal: number | null;
}

type ListFilters = Pick<CatalogueListState, 'q' | 'status' | 'category' | 'sort' | 'page'> & Partial<Pick<CatalogueListState, 'reception' | 'highlight' | 'issue'>>;

type Facet = 'status' | 'highlight' | 'issue';

/** Upper bound of the category facet scan (pages of 1000 rows, PostgREST max-rows). */
const CATEGORY_SCAN_PAGES = 10;

/**
 * Admin catalogue page: one page of products for the list state plus the
 * faceted counters. Shared by the Server Component and GET /api/admin/catalogue.
 */
export async function loadCatalogueList(
  db: SupabaseClient,
  tenantId: string,
  state: ListFilters,
  limit = CATALOGUE_PAGE_SIZE,
): Promise<CatalogueListResult> {
  const page = Math.max(1, state.page);
  const sort = SORT_MAP[state.sort] ?? { column: 'position', ascending: true };

  let categoryId: string | null = null;
  if (state.category) {
    const { data: category } = await db.from('categories').select('id').eq('tenant_id', tenantId).eq('slug', state.category).maybeSingle();
    categoryId = (category as { id: string } | null)?.id ?? '__missing__';
  }
  const q = state.q.trim().replace(/[%_,()]/g, ' ').trim();

  /** Every filter of the list state, minus the facet being counted. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function narrow<Q extends Record<string, any>>(query: Q, skip?: Facet | 'category'): Q {
    let next = query.eq('tenant_id', tenantId);
    if (categoryId && skip !== 'category') next = next.eq('category_id', categoryId);
    if (state.reception) next = next.eq('fulfillment_policy', state.reception);
    if (q) next = next.or(`name.ilike.%${q}%,slug.ilike.%${q}%,barcode_value.ilike.%${q}%`);
    if (skip !== 'status') next = applyCatalogueStatus(next, state.status);
    if (state.highlight && skip !== 'highlight') next = applyCatalogueStatus(next, state.highlight);
    if (state.issue && skip !== 'issue') next = applyCatalogueStatus(next, state.issue);
    return next;
  }

  const query = narrow(db
    .from('products')
    .select(`
      id, name, slug, price, stock, active, weight_grams, category_id,
      image_url, storage_type, fulfillment_policy, warehouse_location, description_source,
      compare_at_price, promo_price, promo_applied, promo_ends_at, new_until,
      barcode_value, net_quantity_display, categories(name, slug)
    `, { count: 'exact' }));

  const from = (page - 1) * limit;
  const head = () => db.from('products').select('id', { count: 'exact', head: true });
  const facets: Array<{ key: CatalogueStatus; skip: Facet }> = [
    ...CATALOGUE_VIEW_OPTIONS.map((option) => ({ key: option.key, skip: 'status' as const })),
    ...CATALOGUE_HIGHLIGHT_OPTIONS.map((option) => ({ key: option.key, skip: 'highlight' as const })),
    ...CATALOGUE_ISSUE_OPTIONS.map((option) => ({ key: option.key, skip: 'issue' as const })),
  ];
  const [{ data, count, error }, totalResult, categoryCounts, ...countResults] = await Promise.all([
    query.order(sort.column, { ascending: sort.ascending }).order('id', { ascending: true }).range(from, from + limit - 1),
    head().eq('tenant_id', tenantId),
    countByCategory(),
    ...facets.map((facet) => applyCatalogueStatus(narrow(head(), facet.skip), facet.key)),
  ]);
  if (error) throw new Error(error.message);

  async function countByCategory(): Promise<Record<string, number> | null> {
    const counts: Record<string, number> = {};
    for (let index = 0; index < CATEGORY_SCAN_PAGES; index += 1) {
      const { data: rows, error: scanError } = await narrow(db.from('products').select('category_id'), 'category')
        .order('id', { ascending: true }).range(index * 1000, index * 1000 + 999);
      if (scanError) return null;
      for (const row of (rows ?? []) as { category_id: string | null }[]) counts[row.category_id ?? ''] = (counts[row.category_id ?? ''] ?? 0) + 1;
      if ((rows ?? []).length < 1000) return counts;
    }
    return counts;
  }

  return {
    products: (data ?? []) as unknown as CatalogueListProduct[],
    total: count ?? 0,
    page,
    limit,
    counts: Object.fromEntries(facets.map((facet, index) => [facet.key, countResults[index]?.error ? null : countResults[index]?.count ?? 0])),
    categoryCounts,
    catalogueTotal: totalResult.error ? null : totalResult.count ?? 0,
  };
}
