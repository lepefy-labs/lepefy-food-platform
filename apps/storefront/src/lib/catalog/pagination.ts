import { PRODUCT_CARD_SELECT } from './productCardSelect';
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

type CatalogPageResult = {
  data: unknown[] | null;
  count: number | null;
  error: { message: string; code?: string } | null;
};

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
  /** Explicit active group membership resolved on the server. */
  productIds?: string[];
}

export function catalogRankingDay(value?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return value === yesterday ? yesterday : today;
}

const PRODUCT_SELECT = PRODUCT_CARD_SELECT;

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

  if (filters.productIds !== undefined) query = query.in('id', filters.productIds);

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
): Promise<CatalogPageResult> {
  if (filters.productIds !== undefined) {
    if (filters.productIds.length === 0) return { data: [], count: 0, error: null };
    // Group-filtered browsing must not call the unfiltered ranking RPC.
    return buildProductsQuery(supabase, tenantId, categories, filters).range(offset, offset + limit - 1);
  }
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Import dynamique : garde next/cache et le client service hors du graphe
    // des tests unitaires qui n'utilisent que buildProductsQuery.
    const { getRankedCatalogIds } = await import('./catalogCache');
    let ranking: { ids: string[]; count: number } | null = null;
    try {
      // L'ordre (IDs) est mis en cache ; les lignes produit ci-dessous restent
      // lues à chaque requête, prix et stock toujours frais.
      ranking = await getRankedCatalogIds(tenantId, {
        categories: categories.map(({ id, slug }) => ({ id, slug })),
        q: (filters.q?.trim() ?? '').slice(0, MAX_SEARCH_QUERY_LENGTH),
        category: filters.category,
        sort: filters.sort ?? 'recommended',
        offset,
        limit,
        rankingDay,
      });
    } catch (error) {
      // An absent RPC during deployment is expected; other errors deserve a log.
      const code = (error as { code?: string }).code;
      if (code !== 'PGRST202' && code !== '42883') console.error('[catalog] Ranking unavailable:', error);
    }
    if (ranking) {
      const { ids, count } = ranking;
      if (!ids.length) return { data: [], count, error: null };
      const result = await supabase.from('products').select(PRODUCT_SELECT)
        .eq('tenant_id', tenantId).eq('active', true).in('id', ids);
      if (result.error) return { data: null, count: null, error: result.error };
      const byId = new Map((result.data ?? []).map(product => [product.id, product]));
      return { data: ids.map(id => byId.get(id)).filter((product): product is NonNullable<typeof product> => Boolean(product)),
        count, error: null };
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
