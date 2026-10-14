import type { SupabaseClient } from '@supabase/supabase-js';
import { applyCatalogueStatus, CATALOGUE_STATUS_OPTIONS, type CatalogueListState, type CatalogueStatus } from './catalogueFilters';

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
  /** Tenant-wide counters per status (null when a count failed). */
  counts: Partial<Record<CatalogueStatus, number | null>>;
}

/**
 * Admin catalogue page: one page of products for the list state plus the
 * per-status counters of the whole catalogue (search, category and reception
 * mode do not narrow the counters). Shared by the Server Component and GET /api/admin/catalogue.
 */
export async function loadCatalogueList(
  db: SupabaseClient,
  tenantId: string,
  state: Pick<CatalogueListState, 'q' | 'status' | 'category' | 'sort' | 'page'> & Partial<Pick<CatalogueListState, 'reception'>>,
  limit = CATALOGUE_PAGE_SIZE,
): Promise<CatalogueListResult> {
  const page = Math.max(1, state.page);
  const sort = SORT_MAP[state.sort] ?? { column: 'position', ascending: true };

  let categoryId: string | null = null;
  if (state.category) {
    const { data: category } = await db.from('categories').select('id').eq('tenant_id', tenantId).eq('slug', state.category).maybeSingle();
    categoryId = (category as { id: string } | null)?.id ?? '__missing__';
  }

  let query = db
    .from('products')
    .select(`
      id, name, slug, price, stock, active, weight_grams, category_id,
      image_url, storage_type, fulfillment_policy, warehouse_location, description_source,
      compare_at_price, promo_price, promo_applied, promo_ends_at, new_until,
      barcode_value, categories(name, slug)
    `, { count: 'exact' })
    .eq('tenant_id', tenantId);

  if (categoryId) query = query.eq('category_id', categoryId);
  if (state.reception) query = query.eq('fulfillment_policy', state.reception);
  const q = state.q.trim();
  if (q) {
    const safe = q.replace(/[%_,()]/g, ' ').trim();
    query = query.or(`name.ilike.%${safe}%,slug.ilike.%${safe}%,barcode_value.ilike.%${safe}%`);
  }
  query = applyCatalogueStatus(query, state.status);

  const from = (page - 1) * limit;
  const countFor = (key: CatalogueStatus) =>
    applyCatalogueStatus(db.from('products').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId), key);
  const [{ data, count, error }, ...countResults] = await Promise.all([
    query.order(sort.column, { ascending: sort.ascending }).order('id', { ascending: true }).range(from, from + limit - 1),
    ...CATALOGUE_STATUS_OPTIONS.map((option) => countFor(option.key)),
  ]);
  if (error) throw new Error(error.message);

  return {
    products: (data ?? []) as unknown as CatalogueListProduct[],
    total: count ?? 0,
    page,
    limit,
    counts: Object.fromEntries(CATALOGUE_STATUS_OPTIONS.map((option, index) => [option.key, countResults[index]?.error ? null : countResults[index]?.count ?? 0])),
  };
}
