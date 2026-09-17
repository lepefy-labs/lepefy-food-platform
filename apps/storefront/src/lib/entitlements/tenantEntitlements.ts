import { createServiceClient } from '@/lib/supabase/server';
import { isTenantFeatureEnabled } from '@/lib/entitlements/tenantFeatureSettings';

export const PLATFORM_FEATURE_KEYS = {
  shop: 'shop',
  events: 'events',
  digitalCard: 'digital_card',
  ai: 'ai',
  nala: 'nala',
  nalaAnalytics: 'nala_analytics',
  nalaConversionAttribution: 'nala_conversion_attribution',
  reviews: 'reviews',
} as const;

interface TenantFeatureOverride {
  enabled: boolean;
  starts_at: string | null;
  expires_at: string | null;
}

function isOverrideApplicable(override: TenantFeatureOverride, now: Date): boolean {
  const nowMs = now.getTime();
  const startsAtMs = override.starts_at ? new Date(override.starts_at).getTime() : null;
  const expiresAtMs = override.expires_at ? new Date(override.expires_at).getTime() : null;

  return (startsAtMs === null || startsAtMs <= nowMs)
    && (expiresAtMs === null || expiresAtMs > nowMs);
}

export async function hasTenantFeature(tenantId: string, featureKey: string): Promise<boolean> {
  const service = createServiceClient();
  const [subscriptionResult, overrideResult] = await Promise.all([
    service.from('tenant_subscriptions').select('plan_id, status').eq('tenant_id', tenantId).maybeSingle(),
    service.from('tenant_feature_overrides').select('enabled, starts_at, expires_at').eq('tenant_id', tenantId).eq('feature_key', featureKey).maybeSingle(),
  ]);

  if (subscriptionResult.error) throw new Error(`Unable to resolve tenant subscription: ${subscriptionResult.error.message}`);
  if (overrideResult.error) throw new Error(`Unable to resolve tenant feature override: ${overrideResult.error.message}`);

  let planEntitlement = false;
  if (subscriptionResult.data?.status === 'active') {
    const { data: planFeature, error: planFeatureError } = await service
      .from('platform_plan_features')
      .select('feature_key')
      .eq('plan_id', subscriptionResult.data.plan_id)
      .eq('feature_key', featureKey)
      .maybeSingle();
    if (planFeatureError) throw new Error(`Unable to resolve plan feature: ${planFeatureError.message}`);
    planEntitlement = Boolean(planFeature);
  }

  const override = overrideResult.data as TenantFeatureOverride | null;
  if (override && isOverrideApplicable(override, new Date())) return override.enabled;
  return planEntitlement;
}

async function canUseOperationalFeature(tenantId: string, featureKey: string, label: string): Promise<boolean> {
  try {
    if (!(await hasTenantFeature(tenantId, featureKey))) return false;
  } catch (error) {
    console.error(`[entitlements] Unable to resolve ${label} entitlement; failing closed.`, { tenantId, error });
    return false;
  }
  try {
    return await isTenantFeatureEnabled(tenantId, featureKey, { defaultEnabled: false });
  } catch (error) {
    console.error(`[entitlements] Unable to resolve ${label} operational setting; failing closed.`, { tenantId, error });
    return false;
  }
}

export async function canUseNala(tenantId: string): Promise<boolean> {
  return canUseOperationalFeature(tenantId, PLATFORM_FEATURE_KEYS.nala, 'Nala');
}

export async function canUseReviews(tenantId: string): Promise<boolean> {
  return canUseOperationalFeature(tenantId, PLATFORM_FEATURE_KEYS.reviews, 'Reviews');
}
