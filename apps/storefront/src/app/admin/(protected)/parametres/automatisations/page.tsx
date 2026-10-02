import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { loadDailyDigestSettings, loadNotificationRecipients } from '../_components/loadSettingsData';
import { DailyDigestSettingsSection } from '../DailyDigestSettingsSection';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Each automation is an autonomous card; future ones (stock alerts, weekly
// reports…) are added to this list with their own tenant_feature_settings key.
export default async function ParametresAutomatisationsPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const db = createServiceClient();
  const [digest, recipients] = await Promise.all([
    loadDailyDigestSettings(db, tenant.id),
    loadNotificationRecipients(db, tenant.id),
  ]);
  const digestRecipients = recipients.filter((recipient) => recipient.active && recipient.subscriptions.includes('daily_digest')).length;

  return (
    <SettingsPageShell sectionKey="automatisations">
      <section aria-label="Automatisations" className="space-y-4">
        <DailyDigestSettingsSection initial={digest.initial} available={digest.available} digestRecipients={digestRecipients} />
      </section>
    </SettingsPageShell>
  );
}
