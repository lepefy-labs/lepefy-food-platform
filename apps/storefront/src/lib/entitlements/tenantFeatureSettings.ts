import { createServiceClient } from '@/lib/supabase/server';

export interface TenantFeatureSetting {
  enabled: boolean;
  config: Record<string, unknown>;
}

interface TenantFeatureSettingOptions {
  defaultEnabled?: boolean;
}

export async function getTenantFeatureSetting(
  tenantId: string,
  featureKey: string,
): Promise<TenantFeatureSetting | null> {
  const service = createServiceClient();
  const { data, error } = await service
    .from('tenant_feature_settings')
    .select('enabled, config')
    .eq('tenant_id', tenantId)
    .eq('feature_key', featureKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to resolve tenant feature setting: ${error.message}`);
  }

  return data
    ? {
        enabled: Boolean(data.enabled),
        config: (data.config ?? {}) as Record<string, unknown>,
      }
    : null;
}

export async function isTenantFeatureEnabled(
  tenantId: string,
  featureKey: string,
  options: TenantFeatureSettingOptions = {},
): Promise<boolean> {
  const setting = await getTenantFeatureSetting(tenantId, featureKey);
  return setting?.enabled ?? options.defaultEnabled ?? false;
}

export async function setTenantFeatureEnabled(
  tenantId: string,
  featureKey: string,
  enabled: boolean,
): Promise<void> {
  const service = createServiceClient();
  const { error } = await service
    .from('tenant_feature_settings')
    .upsert(
      {
        tenant_id: tenantId,
        feature_key: featureKey,
        enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,feature_key' },
    );

  if (error) {
    throw new Error(`Unable to update tenant feature setting: ${error.message}`);
  }
}
