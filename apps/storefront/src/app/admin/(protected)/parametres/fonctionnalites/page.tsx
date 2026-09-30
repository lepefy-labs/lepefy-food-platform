import { getTenant } from '@/lib/tenant/getTenant';
import { listTenantFeatureFlags, type TenantFeatureFlag } from '@/lib/featureFlags/featureFlags';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { FeatureFlagsSection } from '../FeatureFlagsSection';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Flags de déploiement du tenant courant (tenant_feature_flags, migration 138).
export default async function ParametresFonctionnalitesPage() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? '');
  let flags: TenantFeatureFlag[] | null = null;
  try {
    flags = await listTenantFeatureFlags(tenant.id);
  } catch (error) {
    console.error('[parametres/fonctionnalites] feature flags unavailable', tenant.id, error);
  }

  return (
    <SettingsPageShell sectionKey="fonctionnalites">
      <FeatureFlagsSection initialFlags={flags} isTestTenant={Boolean(tenant.is_test)} />
    </SettingsPageShell>
  );
}
