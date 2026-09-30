import { revalidateTag, unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import {
  FEATURE_FLAG_DEFINITIONS,
  FEATURE_FLAG_KEY_PATTERN,
  type FeatureFlagDefinition,
} from '@/lib/featureFlags/featureFlagRegistry';

/**
 * Flag di rilascio per tenant (tenant_feature_flags, migration 138).
 *
 * Ogni feature nuova nasce con un flag, spento di default: viene fatta in
 * merge su main spenta, accesa prima sul tenant di test (lepefy-test), poi
 * sugli altri tenant. Procedura completa in featureFlagRegistry.ts.
 *
 *   if (await isFeatureEnabled(tenant.id, 'nuovo_checkout')) { … }
 *
 * - Riga assente, chiave non valida o errore di lettura → false.
 * - Cache breve (30 s) invalidata da setFeatureFlag(); mai force-static.
 * - Solo server (service role). Distinti da tenant_feature_settings (096),
 *   che resta per i moduli permanenti con config.
 */

const FLAG_CACHE_SECONDS = 30;

export const featureFlagsCacheTag = (tenantId: string) => `feature-flags:${tenantId}`;

export async function isFeatureEnabled(tenantId: string, flagKey: string): Promise<boolean> {
  if (!tenantId || !FEATURE_FLAG_KEY_PATTERN.test(flagKey)) return false;
  try {
    return await unstable_cache(
      async () => {
        const { data, error } = await createServiceClient()
          .from('tenant_feature_flags')
          .select('enabled')
          .eq('tenant_id', tenantId)
          .eq('flag_key', flagKey)
          .maybeSingle();
        // Un errore non viene messo in cache: la richiesta successiva riprova.
        if (error) throw new Error(error.message);
        return Boolean((data as { enabled?: boolean } | null)?.enabled);
      },
      ['tenant-feature-flag', tenantId, flagKey],
      { revalidate: FLAG_CACHE_SECONDS, tags: [featureFlagsCacheTag(tenantId)] },
    )();
  } catch (error) {
    console.error('[feature-flags] read failed — tenant:', tenantId, 'flag:', flagKey, error);
    return false;
  }
}

export interface TenantFeatureFlag extends FeatureFlagDefinition {
  enabled: boolean;
  updatedAt: string | null;
  /** false: riga presente in DB ma flag non più dichiarato nel registro. */
  declared: boolean;
}

/** Vista admin: flag dichiarati nel registro + righe del tenant. Senza cache. */
export async function listTenantFeatureFlags(tenantId: string): Promise<TenantFeatureFlag[]> {
  const { data, error } = await createServiceClient()
    .from('tenant_feature_flags')
    .select('flag_key, enabled, updated_at')
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`Unable to read feature flags: ${error.message}`);

  const rows = new Map(
    ((data ?? []) as Array<{ flag_key: string; enabled: boolean; updated_at: string }>)
      .map((row) => [row.flag_key, row]),
  );
  const declared: TenantFeatureFlag[] = FEATURE_FLAG_DEFINITIONS.map((definition) => {
    const row = rows.get(definition.key);
    return { ...definition, enabled: Boolean(row?.enabled), updatedAt: row?.updated_at ?? null, declared: true };
  });
  const orphans: TenantFeatureFlag[] = Array.from(rows.values())
    .filter((row) => !FEATURE_FLAG_DEFINITIONS.some((definition) => definition.key === row.flag_key))
    .map((row) => ({
      key: row.flag_key,
      label: row.flag_key,
      description: 'Flag non déclaré dans le code.',
      enabled: row.enabled,
      updatedAt: row.updated_at,
      declared: false,
    }));
  return [...declared, ...orphans].sort((a, b) => a.key.localeCompare(b.key));
}

export async function setFeatureFlag(tenantId: string, flagKey: string, enabled: boolean): Promise<void> {
  if (!FEATURE_FLAG_KEY_PATTERN.test(flagKey)) throw new Error(`Invalid feature flag key: ${flagKey}`);
  const { error } = await createServiceClient()
    .from('tenant_feature_flags')
    .upsert(
      { tenant_id: tenantId, flag_key: flagKey, enabled, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id,flag_key' },
    );
  if (error) throw new Error(`Unable to update feature flag: ${error.message}`);
  revalidateTag(featureFlagsCacheTag(tenantId));
}
