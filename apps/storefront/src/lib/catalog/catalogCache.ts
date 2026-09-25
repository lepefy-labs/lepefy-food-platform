import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { catalogCacheTag } from '@/lib/cache/storefrontCache';
import { prioritizedCatalogIds } from './productMerchandising';
import { buildProductsQuery, type CatalogSort } from './pagination';
import type { Category } from '@lepefy/types';

/**
 * Lectures publiques du catalogue mises en Data Cache (tag catalog:<tenant>).
 *
 * Seules des données identiques pour tous les visiteurs passent ici :
 * catégories, ordre des produits (IDs) et visuels décoratifs. Les lignes
 * produit elles-mêmes (prix, stock) restent lues à chaque requête avec le
 * client soumis aux RLS — le cache décide de l'ORDRE, jamais du contenu.
 */

// Assez court pour que le stock épuisé descende vite en bas de liste même
// sans invalidation (commandes payées), assez long pour absorber le trafic.
const RANKING_TTL_SECONDS = 60;
const CATEGORIES_TTL_SECONDS = 300;

function cached<Args extends unknown[], R>(
  tenantId: string,
  key: string,
  ttl: number,
  fn: (...args: Args) => Promise<R>,
) {
  return unstable_cache(fn, [key, tenantId], { revalidate: ttl, tags: [catalogCacheTag(tenantId)] });
}

/** Catégories boutique (scope `shop`) dans l'ordre d'affichage. */
export function getShopCategories(tenantId: string): Promise<Category[]> {
  return cached(tenantId, 'shop-categories', CATEGORIES_TTL_SECONDS, async () => {
    const { data, error } = await createServiceClient()
      .from('categories')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('catalog_scope', 'shop')
      .order('position');
    if (error) throw new Error(`Unable to load categories: ${error.message}`);
    return (data ?? []) as Category[];
  })();
}

export interface CategoryPreviewRow {
  category_id: string | null;
  image_url: string | null;
}

/** Visuels de repli des catégories sans image configurée. */
export function getCategoryPreviewRows(tenantId: string, categoryIds: string[]): Promise<CategoryPreviewRow[]> {
  if (categoryIds.length === 0) return Promise.resolve([]);
  return cached(tenantId, 'category-previews', CATEGORIES_TTL_SECONDS, async (ids: string[]) => {
    const limit = Math.min(Math.max(ids.length * 25, 75), 1000);
    const { data, error } = await createServiceClient()
      .from('products')
      .select('category_id, image_url')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .in('category_id', ids)
      .not('image_url', 'is', null)
      .order('position', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit);
    if (error) throw new Error(`Unable to load category previews: ${error.message}`);
    return (data as CategoryPreviewRow[] | null) ?? [];
  })(categoryIds);
}

export interface RankingInput {
  categories: { id: string; slug: string }[];
  q: string;
  category?: string;
  sort: CatalogSort;
  offset: number;
  limit: number;
  rankingDay: string;
}

export interface RankingResult {
  ids: string[];
  count: number;
}

/**
 * Tranche d'IDs ordonnés (épinglés + RPC de classement) et nombre total.
 * Lève si la RPC échoue : une erreur n'est jamais mise en cache et
 * getCatalogPage retombe alors sur l'ordre par `position`.
 */
export function getRankedCatalogIds(tenantId: string, input: RankingInput): Promise<RankingResult> {
  return cached(tenantId, 'catalog-ranking', RANKING_TTL_SECONDS, async (args: RankingInput): Promise<RankingResult> => {
    const service = createServiceClient();
    const filters = { q: args.q, category: args.category, sort: args.sort };
    const categoryId = !args.q
      ? args.categories.find(category => category.slug === args.category)?.id ?? null
      : null;
    const recommended = args.sort === 'recommended';
    const pins = recommended
      ? await buildProductsQuery(service, tenantId, args.categories, filters).lt('position', 0).gt('stock', 0).range(0, 2399)
      : { data: null, error: null };
    if (pins.error) throw Object.assign(new Error(pins.error.message), { code: pins.error.code });
    const pinnedIds = (pins.data ?? []).map(product => product.id);
    const hasPins = pinnedIds.length > 0;

    const { data: ranking, error } = await service.rpc('catalog_ranked_product_ids', {
      p_tenant_id: tenantId,
      p_category_id: categoryId,
      p_query: args.q,
      p_sort: args.sort,
      p_day: args.rankingDay,
      p_offset: hasPins ? 0 : args.offset,
      p_limit: hasPins ? Math.min(2400, args.offset + args.limit + pinnedIds.length) : args.limit,
    });
    if (error || !ranking) {
      throw Object.assign(new Error(error?.message ?? 'Empty ranking'), { code: error?.code });
    }
    const rows = ranking as { product_id: string; total_count: number }[];
    const rankedIds = rows.map(row => row.product_id);
    const ids = hasPins ? prioritizedCatalogIds(rankedIds, pinnedIds, args.offset, args.limit) : rankedIds;
    if (ids.length) return { ids, count: Number(rows[0]?.total_count ?? 0) };

    // Even a deep-link past the last page retains the real result count.
    const { count, error: countError } = await buildProductsQuery(service, tenantId, args.categories, filters).range(0, 0);
    if (countError) throw new Error(countError.message);
    return { ids: [], count: count ?? 0 };
  })(input);
}
