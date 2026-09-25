import { unstable_cache } from 'next/cache';
import { getTenantSocialLinks } from '@/lib/tenant/getTenantSocialLinks';
import { canUseNala } from '@/lib/entitlements/tenantEntitlements';
import { canShowPublicReviews } from '@/lib/reviews/publicReviewData';
import { shopShellCacheTag } from '@/lib/cache/storefrontCache';
import type { TenantSocialLink } from '@lepefy/types';

export interface ShopShellData {
  socialLinks: TenantSocialLink[];
  nalaEnabled: boolean;
  reviewsAvailable: boolean;
}

/**
 * Données d'affichage du layout boutique (liens sociaux, bouton Nala, lien
 * Avis) — ~8 allers-retours Supabase en série sans cache. Réservé à
 * l'AFFICHAGE : les routes API qui autorisent Nala ou les avis continuent
 * d'appeler canUseNala()/canUseReviews() directement, jamais cette version.
 */
export function getShopShellData(tenantId: string): Promise<ShopShellData> {
  return unstable_cache(
    async (): Promise<ShopShellData> => {
      const [socialLinks, nalaEnabled, reviewsAvailable] = await Promise.all([
        getTenantSocialLinks(tenantId),
        canUseNala(tenantId),
        canShowPublicReviews(tenantId),
      ]);
      return { socialLinks, nalaEnabled, reviewsAvailable };
    },
    ['shop-shell-data', tenantId],
    { revalidate: 300, tags: [shopShellCacheTag(tenantId)] },
  )();
}
