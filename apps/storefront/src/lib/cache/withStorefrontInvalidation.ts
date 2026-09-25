import { getTenant } from '@/lib/tenant/getTenant';
import {
  revalidateCatalogCache,
  revalidateReviewsCache,
  revalidateShopShellCache,
  revalidateTenantCache,
} from '@/lib/cache/storefrontCache';

export type StorefrontCacheScope = 'tenant' | 'catalog' | 'shop-shell' | 'reviews';

/**
 * Enveloppe un handler admin qui modifie des données affichées par le
 * storefront : après une réponse 2xx, les caches concernés sont invalidés
 * pour que la modification soit visible immédiatement (et non au prochain
 * `revalidate`). Une réponse d'erreur n'invalide rien.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withStorefrontInvalidation<H extends (...args: any[]) => Promise<Response>>(
  scopes: StorefrontCacheScope[],
  handler: H,
): H {
  return (async (...args: Parameters<H>) => {
    const response = await handler(...args);
    if (response.ok) {
      if (scopes.includes('tenant')) revalidateTenantCache();
      if (scopes.includes('reviews')) revalidateReviewsCache();
      if (scopes.includes('catalog') || scopes.includes('shop-shell')) {
        const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood').catch(() => null);
        if (tenant && scopes.includes('catalog')) revalidateCatalogCache(tenant.id);
        if (tenant && scopes.includes('shop-shell')) revalidateShopShellCache(tenant.id);
      }
    }
    return response;
  }) as H;
}
