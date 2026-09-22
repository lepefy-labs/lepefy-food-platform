import { createServiceClient } from '@/lib/supabase/server';
import { canUseReviews } from '@/lib/entitlements/tenantEntitlements';
import { getReviewSettings, type ReviewSettings } from '@/lib/reviews/reviewSettings';
import { summarizePublicReviewStats, type PublicReviewSummary, type PublishedReviewStats } from './publicReviewSummary';

// Entitlement, activation and public-display settings must all allow visibility.
async function publicReviewsConfig(tenantId: string): Promise<ReviewSettings | null> {
  if (!(await canUseReviews(tenantId))) return null;
  try {
    const settings = await getReviewSettings(tenantId);
    return settings.publicDisplay ? settings : null;
  } catch (error) {
    console.error('[reviews] Unable to resolve public display settings', { tenantId, error });
    return null;
  }
}

export async function canShowPublicReviews(tenantId: string): Promise<boolean> {
  return Boolean(await publicReviewsConfig(tenantId));
}

export async function getPublicReviewsSummary(tenantId: string): Promise<PublicReviewSummary | null> {
  const settings = await publicReviewsConfig(tenantId);
  if (!settings) return null;

  // The stats view aggregates published reviews only. Never read raw pending reviews.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = createServiceClient() as any;
  const { data, error } = await service.from('tenant_review_stats')
    .select('published_count, average_rating')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    console.warn('[reviews] Public aggregate unavailable', { tenantId, message: error.message });
    // The public /avis link still works; unknown figures must not become "0 reviews".
    return { publishedCount: null, averageRating: null };
  }
  return summarizePublicReviewStats((data ?? null) as PublishedReviewStats | null, settings.minPublicCount);
}
