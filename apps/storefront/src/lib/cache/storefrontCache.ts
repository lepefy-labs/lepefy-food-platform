import { revalidatePath, revalidateTag } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Tags du Data Cache Next.js pour les lectures publiques du storefront.
 *
 * Chaque lecture mise en cache garde aussi un `revalidate` court : un
 * écrivain oublié ne peut donc jamais figer une donnée plus que quelques
 * minutes. Les invalidations ci-dessous rendent simplement le changement
 * visible tout de suite depuis l'admin.
 */
/**
 * Durée de vie des lectures affichées par les pages ISR de la boutique
 * (fiches produit, /accueil, /card, /avis, pages légales) et de leur layout.
 *
 * Next.js 14 rend une page ISR selon la PLUS COURTE durée parmi son
 * `export const revalidate` et chaque `unstable_cache` lu pendant le rendu
 * (`next/dist/server/web/spec-extension/unstable-cache.js`) : une lecture à
 * 60 s rend toute la page toutes les 60 s de trafic. Ces pages lisent donc
 * des variantes « affichage » à cette durée ; chaque écriture connue
 * invalide le tag correspondant (admin, tick promo, stock des commandes),
 * et la durée ne borne que les écrivains qui n'invalident pas.
 * Le checkout et les API relisent toujours les variantes courtes ou la base.
 */
export const SHOP_DISPLAY_TTL_SECONDS = 3600;

/**
 * Route of the product pages for `revalidatePath(…, 'page')`. Next.js derives a
 * page's implicit tags from its file path WITH the route group
 * (`/(shop)/products/[slug]/page`): `'/products/[slug]'` matches no page and
 * purges nothing. Exact paths (`/products/<slug>`, `/accueil`) need no group.
 */
export const PRODUCT_PAGE_ROUTE = '/(shop)/products/[slug]';

export const TENANT_CACHE_TAG = 'tenant';
export const catalogCacheTag = (tenantId: string) => `catalog:${tenantId}`;
export const shopShellCacheTag = (tenantId: string) => `shop-shell:${tenantId}`;

// revalidateTag/revalidatePath lèvent hors d'un contexte de requête Next
// (scripts, tests unitaires) : une invalidation manquée ne doit jamais faire
// échouer l'écriture qui vient de réussir.
function safely(fn: () => void) {
  try {
    fn();
  } catch (error) {
    console.warn('[cache] Invalidation skipped', error);
  }
}

/** Configuration tenant (branding, textes, options) : toutes les pages l'affichent. */
export function revalidateTenantCache() {
  safely(() => {
    revalidateTag(TENANT_CACHE_TAG);
    revalidatePath('/', 'layout');
  });
}

/** Produits, catégories, classement, groupes de quantité. */
export function revalidateCatalogCache(tenantId: string) {
  safely(() => {
    revalidateTag(catalogCacheTag(tenantId));
    revalidatePath(PRODUCT_PAGE_ROUTE, 'page');
    revalidatePath('/accueil');
    revalidatePath('/gadgets');
    // Vitrine « Nos produits en vedette » de /card (ISR).
    revalidatePath('/card');
  });
}

/** Page publique /avis (ISR) : modération ou réglages d'affichage. */
export function revalidateReviewsCache() {
  safely(() => {
    revalidatePath('/avis');
  });
}

/** Réseaux sociaux, Nala et avis affichés par le layout boutique. */
export function revalidateShopShellCache(tenantId: string) {
  safely(() => {
    revalidateTag(shopShellCacheTag(tenantId));
    revalidatePath('/', 'layout');
  });
}

/** Pages à rafraîchir quand la disponibilité de ces fiches change (stock). */
export function productAvailabilityPaths(slugs: Array<string | null | undefined>): string[] {
  const productPaths = [...new Set(slugs.filter((slug): slug is string => typeof slug === 'string' && slug.length > 0))]
    .map((slug) => `/products/${slug}`);
  // /accueil et /card affichent des produits achetables (stock, minimum).
  return productPaths.length > 0 ? [...productPaths, '/accueil', '/card'] : [];
}

const MAX_PRODUCTS_PER_REVALIDATION = 100;

/**
 * Stock modifié hors de l'admin catalogue (commande payée, vente en
 * boutique) : rafraîchit seulement les fiches concernées, jamais tout le
 * catalogue. Ne lève jamais — une invalidation manquée ne doit pas faire
 * échouer une commande ; la fiche reste bornée par SHOP_DISPLAY_TTL_SECONDS
 * et le checkout revalide toujours stock et prix.
 */
export async function revalidateProductAvailability(db: SupabaseClient, tenantId: string, productIds: Array<string | null | undefined>): Promise<void> {
  try {
    const ids = [...new Set(productIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, MAX_PRODUCTS_PER_REVALIDATION);
    if (ids.length === 0) return;
    const { data, error } = await db.from('products').select('slug').eq('tenant_id', tenantId).in('id', ids);
    if (error) throw error;
    const paths = productAvailabilityPaths(((data ?? []) as Array<{ slug: string | null }>).map((row) => row.slug));
    safely(() => { for (const path of paths) revalidatePath(path); });
  } catch (error) {
    console.warn('[cache] Product availability invalidation skipped', error);
  }
}

/** Même chose à partir des lignes d'une commande déjà enregistrée. */
export async function revalidateOrderProductAvailability(db: SupabaseClient, tenantId: string, orderId: string): Promise<void> {
  try {
    const { data, error } = await db.from('order_items').select('product_id').eq('order_id', orderId).eq('tenant_id', tenantId);
    if (error) throw error;
    await revalidateProductAvailability(db, tenantId, ((data ?? []) as Array<{ product_id: string | null }>).map((row) => row.product_id));
  } catch (error) {
    console.warn('[cache] Order product invalidation skipped', error);
  }
}
