import type { Metadata } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getAiCapabilities } from '@/lib/ai/aiSettings';
import { CatalogClient } from '@/components/catalog/CatalogClient';
import { catalogRankingDay, getCatalogPage, parseCatalogSort, parsePageParam, PRODUCTS_PAGE_SIZE } from '@/lib/catalog/pagination';
import { getActiveQuantityGroupFilter } from '@/lib/catalog/quantityGroupFilter';
import { getCategoryPreviewRows, getShopCategories } from '@/lib/catalog/catalogCache';
import { getActivePromotions, PROMOTIONS_SHELF_LIMIT } from '@/lib/catalog/promotions';
import { getActiveNovelties, NOVELTIES_SHELF_LIMIT } from '@/lib/catalog/novelties';
import { ADD_ONS_SHELF_LIMIT, getAddOnProducts } from '@/lib/catalog/addOnShelf';
import { isPromoFilter } from '@/lib/catalog/catalogSearchUrl';
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
  searchParams: { category?: string; q?: string; page?: string; sort?: string; day?: string; quantityGroup?: string; promo?: string; new?: string };
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
  // « Nos promos » : promotions actives de ce tenant (prix barré > prix,
  // achetables), lues fraîches à chaque rendu comme les autres lignes produit.
  const promoView = isPromoFilter(searchParams.promo) && !searchQuery && !quantityGroupId;
  // « Nouveautés » : produits choisis par le commerçant, jusqu'à leur date (migration 156).
  const noveltyView = !promoView && isPromoFilter(searchParams.new) && !searchQuery && !quantityGroupId;
  const shopCategoryIds = categories.map(category => category.id);
  const promotionsPromise = getActivePromotions<ProductWithCategory>(supabase, tenant.id, shopCategoryIds)
    .catch(() => [] as ProductWithCategory[]);
  const noveltiesPromise = getActiveNovelties<ProductWithCategory>(supabase, tenant.id, shopCategoryIds)
    .catch(() => [] as ProductWithCategory[]);
  // « Les petits plus » choisis par la boutique (migration 165), après Promos et Nouveautés.
  const addOnsPromise = getAddOnProducts<ProductWithCategory>(supabase, tenant.id, shopCategoryIds)
    .catch(() => [] as ProductWithCategory[]);
  // Catalogue non filtré : blocs « Nos promos » puis « Nouveautés » ; leurs
  // produits ne sont pas répétés dans « Tous les produits » (exclus avant la
  // découpe en pages, pour la page et pour /api/products).
  const showShelves = !promoView && !noveltyView && !searchQuery && !searchParams.category && !quantityGroupId;
  const [previewRows, promotions, novelties, addOns] = await Promise.all([previewRowsPromise, promotionsPromise, noveltiesPromise, addOnsPromise]);
  const promoShelf = showShelves ? promotions.slice(0, PROMOTIONS_SHELF_LIMIT) : [];
  const promoShelfIds = new Set(promoShelf.map(product => product.id));
  // Un produit en promo et nouveauté n'apparaît que dans le bloc Promos.
  const noveltyShelf = showShelves
    ? novelties.filter(product => !promoShelfIds.has(product.id)).slice(0, NOVELTIES_SHELF_LIMIT)
    : [];
  // Un produit déjà dans Promos ou Nouveautés n'est pas répété dans les petits plus.
  const shelvedIds = new Set([...promoShelf, ...noveltyShelf].map(product => product.id));
  const addOnShelf = showShelves
    ? addOns.filter(product => !shelvedIds.has(product.id)).slice(0, ADD_ONS_SHELF_LIMIT)
    : [];
  const excludeIds = [...promoShelf, ...noveltyShelf, ...addOnShelf].map(product => product.id);
  const { data: productsRaw, count } = promoView || noveltyView
    ? { data: null, count: null }
    : await getCatalogPage(supabase, tenant.id, categories, {
      q: searchQuery,
      category: searchParams.category,
      productIds: quantityGroupId ? quantityGroup?.productIds ?? [] : undefined,
      excludeIds,
      sort,
    }, 0, page * PRODUCTS_PAGE_SIZE, rankingDay);

  const previewImagesByCategory: Record<string, string[]> = {};
  for (const row of previewRows) {
    const imageUrl = row.image_url?.trim();
    if (!row.category_id || !imageUrl) continue;
    const images = previewImagesByCategory[row.category_id] ?? [];
    if (images.length < 3 && !images.includes(imageUrl)) {
      previewImagesByCategory[row.category_id] = [...images, imageUrl];
    }
  }

  // La vue promo montre toutes les promotions d'un coup (peu nombreuses, déjà
  // triées par remise) : pas de page suivante.
  const products: ProductWithCategory[] = promoView
    ? promotions
    : noveltyView
      ? novelties
      : (productsRaw as unknown as ProductWithCategory[] | null) ?? [];
  const totalCount = promoView || noveltyView ? products.length : count ?? products.length;
  const hasNextPage = !promoView && !noveltyView && page * PRODUCTS_PAGE_SIZE < totalCount;

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
      promoView={promoView}
      noveltyView={noveltyView}
      noveltyCount={novelties.length}
      promoCount={promotions.length}
      promoShelf={promoShelf}
      noveltyShelf={noveltyShelf}
      addOnShelf={addOnShelf}
      excludeIds={excludeIds}
    />
  );
}
