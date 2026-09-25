import { revalidatePath, revalidateTag } from 'next/cache';

/**
 * Tags du Data Cache Next.js pour les lectures publiques du storefront.
 *
 * Chaque lecture mise en cache garde aussi un `revalidate` court : un
 * écrivain oublié ne peut donc jamais figer une donnée plus que quelques
 * minutes. Les invalidations ci-dessous rendent simplement le changement
 * visible tout de suite depuis l'admin.
 */
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
    revalidatePath('/products/[slug]', 'page');
    revalidatePath('/accueil');
    revalidatePath('/gadgets');
  });
}

/** Réseaux sociaux, Nala et avis affichés par le layout boutique. */
export function revalidateShopShellCache(tenantId: string) {
  safely(() => {
    revalidateTag(shopShellCacheTag(tenantId));
    revalidatePath('/', 'layout');
  });
}
