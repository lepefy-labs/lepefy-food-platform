import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createClient } from '@/lib/supabase/server';
import { buildProductsQuery, parsePageParam, PRODUCTS_PAGE_SIZE } from '@/lib/catalog/pagination';

// Toujours dynamique : dépend de ?page=/?q=/?category=, jamais cacheable
// comme une réponse unique. Explicite depuis que getTenant() n'utilise plus
// cookies() (Prompt 4) — sans ce marqueur cette route perdait son seul
// déclencheur dynamique implicite.
export const dynamic = 'force-dynamic';

/**
 * Page suivante du catalogue pour le bouton "Charger plus" (CatalogClient).
 * Contrairement au SSR de /products (range cumulatif), cette route ne
 * renvoie que la tranche de la page demandée : le client accumule déjà les
 * pages précédentes en mémoire, inutile de les re-transférer.
 */
export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createClient();

  const { data: categoriesRaw } = await supabase
    .from('categories')
    .select('id, slug')
    .eq('tenant_id', tenant.id)
    .eq('catalog_scope', 'shop');
  const categories = categoriesRaw ?? [];

  const page = parsePageParam(req.nextUrl.searchParams.get('page') ?? undefined);
  const q = req.nextUrl.searchParams.get('q') ?? undefined;
  const category = req.nextUrl.searchParams.get('category') ?? undefined;

  const { data: productsRaw, count, error } = await buildProductsQuery(supabase, tenant.id, categories, {
    q,
    category,
  }).range((page - 1) * PRODUCTS_PAGE_SIZE, page * PRODUCTS_PAGE_SIZE - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const products = productsRaw ?? [];
  const totalCount = count ?? 0;
  const hasNextPage = page * PRODUCTS_PAGE_SIZE < totalCount;

  return NextResponse.json({ products, hasNextPage, totalCount });
}
