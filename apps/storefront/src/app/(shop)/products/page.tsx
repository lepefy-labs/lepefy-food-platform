import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';
import { createClient } from '@/lib/supabase/server';
import { CatalogClient } from '@/components/catalog/CatalogClient';
import { buildProductsQuery, parsePageParam, PRODUCTS_PAGE_SIZE } from '@/lib/catalog/pagination';
import type { Category, ProductWithCategory } from '@lepefy/types';

// Toujours dynamique : recherche/filtre/pagination pilotés par ?q=/?category=/
// ?page=, jamais une même réponse pour tous. Explicite depuis que getTenant()
// n'utilise plus cookies() (Prompt 4) — sans ce marqueur cette page perdait
// son seul déclencheur dynamique implicite (le cookie-bound client utilisé
// plus bas n'est atteint qu'après getTenant(), donc pas garanti détecté).
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  return { title: 'Catalogue', description: `Découvrez les produits de ${tenant.name}` };
}

interface ProductsPageProps {
  searchParams: { category?: string; q?: string; page?: string };
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const supabase = createClient();

  const { data: categoriesRaw } = await supabase
    .from('categories')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('position');
  const categories: Category[] = categoriesRaw ?? [];

  const searchQuery = searchParams.q?.trim() ?? '';
  const page = parsePageParam(searchParams.page);

  // Range cumulatif (0 → page*PAGE_SIZE-1), pas la seule tranche de `page` :
  // un accès direct/partagé à /products?page=3 doit afficher le même
  // ensemble cumulé (72 produits) que 2 clics sur "Charger plus" depuis la
  // page 1, pas seulement les produits 49-72. Pour page=1 les deux formules
  // coïncident, donc le SSR de la première page reste inchangé.
  const { data: productsRaw, count } = await buildProductsQuery(supabase, tenant.id, categories, {
    q: searchQuery,
    category: searchParams.category,
  }).range(0, page * PRODUCTS_PAGE_SIZE - 1);

  const products: ProductWithCategory[] = (productsRaw as unknown as ProductWithCategory[] | null) ?? [];
  const totalCount = count ?? products.length;
  const hasNextPage = page * PRODUCTS_PAGE_SIZE < totalCount;

  return (
    <CatalogClient
      categories={categories}
      products={products}
      activeSlug={searchQuery ? undefined : searchParams.category}
      initialQuery={searchQuery}
      semanticEnabled={tenant.ai_semantic_search ?? false}
      totalCount={totalCount}
      currentPage={page}
      hasNextPage={hasNextPage}
    />
  );
}
