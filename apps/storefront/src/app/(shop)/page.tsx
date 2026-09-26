import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getAiCapabilities } from '@/lib/ai/aiSettings';
import { CatalogClient } from '@/components/catalog/CatalogClient';
import { catalogRankingDay, getCatalogPage, parseCatalogSort, parsePageParam, PRODUCTS_PAGE_SIZE } from '@/lib/catalog/pagination';
import { getActiveQuantityGroupFilter } from '@/lib/catalog/quantityGroupFilter';
import { getCategoryPreviewRows, getShopCategories } from '@/lib/catalog/catalogCache';
import type { ProductWithCategory } from '@lepefy/types';

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
  searchParams: { category?: string; q?: string; page?: string; sort?: string; day?: string; quantityGroup?: string };
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const supabase = createClient();
  // AI settings are server-only (tenant_feature_settings, migration 134).
  const ai = await getAiCapabilities(createServiceClient(), tenant.id, tenant);

  const categories = await getShopCategories(tenant.id).catch(() => []);
  const searchQuery = searchParams.q?.trim() ?? '';
  const page = parsePageParam(searchParams.page);
  const sort = parseCatalogSort(searchParams.sort);
  const rankingDay = catalogRankingDay(searchParams.day);
  const quantityGroupId = searchParams.quantityGroup;
  const quantityGroup = quantityGroupId
    ? await getActiveQuantityGroupFilter(supabase, tenant.id, quantityGroupId)
    : null;

  // Une seule requête pour toutes les catégories sans visuel configuré :
  // le regroupement et la limite de 3 images restent côté serveur.
  const previewCategoryIds = categories.filter(category => !category.image_url).map(category => category.id);
  const previewRowsPromise = searchQuery
    ? Promise.resolve([])
    : getCategoryPreviewRows(tenant.id, previewCategoryIds).catch(() => []);

  // Range cumulatif (0 → page*PAGE_SIZE-1) pour préserver les liens directs
  // ?page=N. Le catalogue et ses visuels décoratifs sont indépendants après la lecture
  // des catégories : les deux requêtes partent ensemble pour limiter la latence.
  const [previewRows, { data: productsRaw, count }] = await Promise.all([
    previewRowsPromise,
    getCatalogPage(supabase, tenant.id, categories, {
      q: searchQuery,
      category: searchParams.category,
      productIds: quantityGroupId ? quantityGroup?.productIds ?? [] : undefined,
      sort,
    }, 0, page * PRODUCTS_PAGE_SIZE, rankingDay),
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
      semanticEnabled={ai.semanticSearch && !quantityGroupId}
      quantityGroupId={quantityGroup?.id}
      quantityGroupName={quantityGroup?.name}
      totalCount={totalCount}
      currentPage={page}
      hasNextPage={hasNextPage}
      sort={sort}
      rankingDay={rankingDay}
    />
  );
}
