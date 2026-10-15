import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createClient } from '@/lib/supabase/server';
import { catalogRankingDay, getCatalogPage, parseCatalogSort, parseExcludeParam, parseLimitParam, parsePageParam } from '@/lib/catalog/pagination';
import { getActiveQuantityGroupFilter } from '@/lib/catalog/quantityGroupFilter';
import { getShopCategories } from '@/lib/catalog/catalogCache';
import { getSimilarProducts } from '@/lib/catalog/similarProducts';

// Toujours dynamique : dépend de ?page=/?q=/?category=, jamais cacheable
// comme une réponse unique. Explicite depuis que getTenant() n'utilise plus
// cookies() (Prompt 4) — sans ce marqueur cette route perdait son seul
// déclencheur dynamique implicite.
export const dynamic = 'force-dynamic';

/**
 * Page suivante du catalogue pour le scroll infini (CatalogClient).
 * Contrairement au SSR de /products (range cumulatif), cette route ne
 * renvoie que la tranche de la page demandée : le client accumule déjà les
 * pages précédentes en mémoire, inutile de les re-transférer.
 * `?limit=` (≤ taille de page) sert aux propositions de la recherche globale :
 * même requête, mêmes filtres tenant/scope, seulement moins de lignes.
 * `?similar=1` (recherche du panier) : quand la recherche exacte trouve moins
 * de `limit` produits en page 1, `similar` complète avec des noms proches
 * (fautes de frappe, accents), séparés des résultats exacts.
 */
export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createClient();

  const categories = await getShopCategories(tenant.id).catch(() => []);

  const page = parsePageParam(req.nextUrl.searchParams.get('page') ?? undefined);
  const limit = parseLimitParam(req.nextUrl.searchParams.get('limit'));
  const q = req.nextUrl.searchParams.get('q') ?? undefined;
  const category = req.nextUrl.searchParams.get('category') ?? undefined;
  const groupId = req.nextUrl.searchParams.get('quantityGroup');
  const group = groupId
    ? await getActiveQuantityGroupFilter(supabase, tenant.id, groupId)
    : null;
  // Produits des blocs Promos / Nouveautés : seulement sur le catalogue non filtré,
  // comme la page (une recherche ou une catégorie montre toute la liste).
  const excludeIds = !q?.trim() && !category && !groupId
    ? parseExcludeParam(req.nextUrl.searchParams.get('exclude'))
    : [];

  const { data: productsRaw, count, error } = await getCatalogPage(supabase, tenant.id, categories, {
    q,
    category,
    productIds: groupId ? group?.productIds ?? [] : undefined,
    excludeIds,
    sort: parseCatalogSort(req.nextUrl.searchParams.get('sort') ?? undefined),
  }, (page - 1) * limit, limit,
  catalogRankingDay(req.nextUrl.searchParams.get('day') ?? undefined));

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const products = productsRaw ?? [];
  const totalCount = count ?? 0;
  const hasNextPage = page * limit < totalCount;

  const wantsSimilar = req.nextUrl.searchParams.get('similar') === '1' && Boolean(q?.trim()) && !category && !groupId && page === 1;
  const similar = wantsSimilar && products.length < limit
    ? await getSimilarProducts(
      supabase,
      tenant.id,
      categories.map((c) => c.id),
      q ?? '',
      (products as Array<{ id: string }>).map((p) => p.id),
      limit - products.length,
    ).catch(() => [])
    : [];

  return NextResponse.json({ products, hasNextPage, totalCount, ...(wantsSimilar ? { similar } : {}) });
}
