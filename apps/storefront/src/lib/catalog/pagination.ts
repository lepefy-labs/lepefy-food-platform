import type { createClient } from '@/lib/supabase/server';

/** Taille de page de plateforme — pas de valeur par tenant, cf. contrainte
 *  multi-tenant du prompt de perf (audit §Roadmap, Prompt 3). Fixée ici,
 *  côté serveur uniquement : ni /products (SSR) ni /api/products (page
 *  suivante) ne lisent de paramètre client pour la faire varier. */
export const PRODUCTS_PAGE_SIZE = 24;

// Plafond défensif sur `page` — évite qu'un numéro de page absurdement grand
// (dépassant les bornes bigint côté Postgres une fois multiplié par
// PRODUCTS_PAGE_SIZE) ne remonte comme une erreur 500 brute jusqu'au client.
const MAX_PAGE = 100_000;

// Même convention que /api/search/semantic (MAX_QUERY_LENGTH) : borne la
// recherche texte pour éviter qu'une chaîne dégénérée (très longue) ne soit
// transmise telle quelle à ILIKE.
const MAX_SEARCH_QUERY_LENGTH = 100;

type SupabaseClient = ReturnType<typeof createClient>;

interface CategoryFilterInput {
  id: string;
  slug: string;
}

interface ProductsFilters {
  q?: string;
  category?: string;
}

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
    .select(
      `
      id, name, slug, price, compare_at_price, image_url,
      weight_grams, stock, storage_type,
      category:categories(name)
    `,
      { count: 'exact' },
    )
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('position');

  const searchQuery = (filters.q?.trim() ?? '').slice(0, MAX_SEARCH_QUERY_LENGTH);

  if (searchQuery) {
    // Ricerca full-text case-insensitive sul nome
    query = query.ilike('name', `%${searchQuery}%`);
  } else if (filters.category) {
    const activeCategory = categories.find((c) => c.slug === filters.category);
    if (activeCategory) query = query.eq('category_id', activeCategory.id);
  }

  return query;
}

/** Parse et normalise le paramètre `?page=` — jamais < 1, jamais NaN,
 *  jamais au-delà de MAX_PAGE (numéro non-numérique, négatif, décimal ou
 *  absurdement grand retombent tous sur une valeur sûre, sans jamais lever). */
export function parsePageParam(raw: string | undefined): number {
  const n = Number(raw ?? '1');
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), MAX_PAGE);
}
