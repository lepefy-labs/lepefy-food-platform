import type { createClient } from '@/lib/supabase/server';

/** Taille de page de plateforme — pas de valeur par tenant, cf. contrainte
 *  multi-tenant du prompt de perf (audit §Roadmap, Prompt 3). */
export const PRODUCTS_PAGE_SIZE = 24;

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
      id, name, slug, price, image_url,
      weight_grams, stock, storage_type,
      category:categories(name)
    `,
      { count: 'exact' },
    )
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('position');

  const searchQuery = filters.q?.trim() ?? '';

  if (searchQuery) {
    // Ricerca full-text case-insensitive sul nome
    query = query.ilike('name', `%${searchQuery}%`);
  } else if (filters.category) {
    const activeCategory = categories.find((c) => c.slug === filters.category);
    if (activeCategory) query = query.eq('category_id', activeCategory.id);
  }

  return query;
}

/** Parse et normalise le paramètre `?page=` — jamais < 1, jamais NaN. */
export function parsePageParam(raw: string | undefined): number {
  const n = Number(raw ?? '1');
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
