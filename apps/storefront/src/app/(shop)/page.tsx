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

type CategoryPreviewRow = {
  category_id: string | null;
  image_url: string | null;
};

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const supabase = createClient();

  const { data: categoriesRaw } = await supabase
    .from('categories')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('catalog_scope', 'shop')
    .order('position');
  const categories: Category[] = categoriesRaw ?? [];
  const searchQuery = searchParams.q?.trim() ?? '';
  const page = parsePageParam(searchParams.page);

  // Une seule requête pour toutes les catégories sans visuel configuré :
  // le regroupement et la limite de 3 images restent côté serveur.
  const previewCategoryIds = categories.filter(category => !category.image_url).map(category => category.id);
  const previewRowsPromise = (async (): Promise<CategoryPreviewRow[]> => {
    if (searchQuery || previewCategoryIds.length === 0) return [];
    const previewQueryLimit = Math.min(Math.max(previewCategoryIds.length * 25, 75), 1000);
    const { data } = await supabase
      .from('products')
      .select('category_id, image_url')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .in('category_id', previewCategoryIds)
      .not('image_url', 'is', null)
      .order('position', { ascending: true })
      .order('id', { ascending: true })
      .limit(previewQueryLimit);
    return (data as CategoryPreviewRow[] | null) ?? [];
  })();

  // Range cumulatif (0 → page*PAGE_SIZE-1) pour préserver les liens directs
  // ?page=N. Le catalogue et ses visuels décoratifs sont indépendants après la lecture
  // des catégories : les deux requêtes partent ensemble pour limiter la latence.
  const [previewRows, { data: productsRaw, count }] = await Promise.all([
    previewRowsPromise,
    buildProductsQuery(supabase, tenant.id, categories, {
      q: searchQuery,
      category: searchParams.category,
    }).range(0, page * PRODUCTS_PAGE_SIZE - 1),
  ]);

  const previewImagesByCategory: Record<string, string[]> = {};
  for (const row of previewRows) {
    const imageUrl = row.image_url?.trim();
    if (!row.category_id || !imageUrl) continue;
    const images = previewImagesByCategory[row.category_id] ?? [];
    if (images.length < 3 && !images.includes(imageUrl)) {
      previewImagesByCategory[row.category_id] = [...images, imageUrl];
    }
  }

  const products: ProductWithCategory[] = (productsRaw as unknown as ProductWithCategory[] | null) ?? [];
  const totalCount = count ?? products.length;
  const hasNextPage = page * PRODUCTS_PAGE_SIZE < totalCount;

  return (
    <CatalogClient
      categories={categories}
      previewImagesByCategory={previewImagesByCategory}
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
