import { getTenant } from '@/lib/tenant/getTenant';
import { canAdmin, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { createServiceClient } from '@/lib/supabase/server';
import { readDigitalCardSettings } from '@/lib/card/digitalCardSettings';
import { defaultTimezone } from '@/lib/card/openingHours';
import { PickupSettingsClient } from './PickupSettingsClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// One pickup point today (tenants.click_collect_*). Opening hours and
// exceptional closures live in tenant_feature_settings('digital_card'); saving
// them also regenerates tenants.click_collect_hours / _it (e-mails, Nala).
export default async function ParametresRetraitPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const [cardSettings, access] = await Promise.all([
    readDigitalCardSettings(createServiceClient(), tenant.id).catch(() => null),
    getCurrentAdminAccessContext(tenant.id),
  ]);
  const openingHours = cardSettings?.status === 'ok' ? cardSettings.config.opening_hours : null;

  return (
    <SettingsPageShell sectionKey="retrait">
      <PickupSettingsClient
        initialPoint={{ address: tenant.click_collect_address ?? '', mapsUrl: tenant.google_maps_url ?? '' }}
        initialHours={openingHours}
        currentHoursText={{ fr: tenant.click_collect_hours ?? '', it: tenant.click_collect_hours_it ?? '' }}
        defaultTimezone={openingHours?.timezone ?? defaultTimezone(tenant.country)}
        clickCollectEnabled={tenant.click_collect_enabled}
        readOnly={!(access && canAdmin(access, 'tenant_settings.manage'))}
      />
    </SettingsPageShell>
  );
}
