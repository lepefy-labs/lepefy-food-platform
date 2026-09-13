import type { createClient } from '@/lib/supabase/server';

/** Taille de page de plateforme — pas de valeur par tenant, cf. contrainte
 *  multi-tenant du prompt de perf (audit §Roadmap, Prompt 3). Fixée ici,
 *  côté serveur uniquement : ni /products (SSR) ni /api/products (page
 *  suivante) ne lisent de paramètre client pour la faire varier. */
export const PRODUCTS_PAGE_SIZE = 24;

// Plafond défensif sur `page` — le rendu SSR est cumulatif et la RPC
// limite chaque lecture à 2400 produits au maximum.
const MAX_PAGE = 100;

// Même convention que /api/search/semantic (MAX_QUERY_LENGTH) : borne la
// recherche texte pour éviter qu'une chaîne dégénérée (très longue) ne soit
// transmise telle quelle à ILIKE.
const MAX_SEARCH_QUERY_LENGTH = 100;

type SupabaseClient = ReturnType<typeof createClient>;

interface CategoryFilterInput {
  id: string;
  slug: string;
}

export type CatalogSort = 'recommended' | 'bestsellers' | 'newest' | 'price_asc' | 'price_desc';

export function parseCatalogSort(value: string | undefined): CatalogSort {
  if (value === 'bestsellers' || value === 'newest' || value === 'price_asc' || value === 'price_desc') return value;
  return 'recommended';
}

interface ProductsFilters {
  q?: string;
  category?: string;
  sort?: CatalogSort;
}

export function catalogRankingDay(value?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return value === yesterday ? yesterday : today;
}

const PRODUCT_SELECT = `
  id, name, slug, price, compare_at_price, image_url,
  weight_grams, stock, storage_type,
  category:categories(name)
`;

/**
 * Construit la requête `products` filtrée (tenant, active, recherche
 * textuelle ou catégorie) sans appliquer de `.range()` — partagée entre le
 * rendu SSR de `/products` et la route `/api/products` (page suivante) pour
 * que les deux ne puissent jamais diverger sur les filtres appliqués.
 */
export function buildProductsQuery(
  supabase: SupabaseClient,
  tenantId: string,
  categories: CategoryFilterInput[],
  filters: ProductsFilters,
) {
  let query = supabase
    .from('products')
    .select(PRODUCT_SELECT, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .in('category_id', categories.map(category => category.id));

  const searchQuery = (filters.q?.trim() ?? '').slice(0, MAX_SEARCH_QUERY_LENGTH);

  if (searchQuery) {
    // Ricerca full-text case-insensitive sul nome
    query = query.ilike('name', `%${searchQuery}%`);
  } else if (filters.category) {
    const activeCategory = categories.find((c) => c.slug === filters.category);
    if (activeCategory) query = query.eq('category_id', activeCategory.id);
  }

  if (filters.sort === 'newest') query = query.order('created_at', { ascending: false });
  if (filters.sort === 'price_asc') query = query.order('price', { ascending: true });
  if (filters.sort === 'price_desc') query = query.order('price', { ascending: false });
  return query.order('position').order('id');
}

/**
 * Shared SSR/API ordering. The server-only RPC returns IDs (never sales data)
 * in a stable order before pagination; the public product lookup preserves RLS.
 * Until the additive migration is applied, retain the existing position order.
 */
export async function getCatalogPage(
  supabase: SupabaseClient,
  tenantId: string,
  categories: CategoryFilterInput[],
  filters: ProductsFilters,
  offset: number,
  limit: number,
  rankingDay: string,
) {
  const { createServiceClient } = await import('@/lib/supabase/server');
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const categoryId = !filters.q?.trim()
      ? categories.find(category => category.slug === filters.category)?.id ?? null
      : null;
    const service = createServiceClient();
    const { data: ranking, error } = await service.rpc('catalog_ranked_product_ids', {
      p_tenant_id: tenantId,
      p_category_id: categoryId,
      p_query: (filters.q?.trim() ?? '').slice(0, MAX_SEARCH_QUERY_LENGTH),
      p_sort: filters.sort ?? 'recommended',
      p_day: rankingDay,
      p_offset: offset,
      p_limit: limit,
    });
    if (!error && ranking) {
      const rows = ranking as { product_id: string; total_count: number }[];
      const ids = rows.map(row => row.product_id);
      if (!ids.length) {
        // Even a deep-link past the last page retains the real result count.
        const { count, error: countError } = await buildProductsQuery(supabase, tenantId, categories, filters).range(0, 0);
        if (countError) return { data: null, count: null, error: countError };
        return { data: [], count: count ?? 0, error: null };
      }
      const result = await supabase.from('products').select(PRODUCT_SELECT)
        .eq('tenant_id', tenantId).eq('active', true).in('id', ids);
      if (result.error) return { data: null, count: null, error: result.error };
      const byId = new Map((result.data ?? []).map(product => [product.id, product]));
      return { data: ids.map(id => byId.get(id)).filter((product): product is NonNullable<typeof product> => Boolean(product)),
        count: Number(rows[0].total_count), error: null };
    }
    // An absent RPC during deployment is expected; other errors deserve a log.
    if (error && error.code !== 'PGRST202' && error.code !== '42883') {
      console.error('[catalog] Ranking unavailable:', error);
    }
  }
  return buildProductsQuery(supabase, tenantId, categories, filters).range(offset, offset + limit - 1);
}

/** Parse et normalise le paramètre `?page=` — jamais < 1, jamais NaN,
 *  jamais au-delà de MAX_PAGE (numéro non-numérique, négatif, décimal ou
 *  absurdement grand retombent tous sur une valeur sûre, sans jamais lever). */
export function parsePageParam(raw: string | undefined): number {
  const n = Number(raw ?? '1');
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), MAX_PAGE);
}
