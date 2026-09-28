import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { loadNotificationRecipients } from '../_components/loadSettingsData';
import { NotificationRecipientsSection } from '../NotificationRecipientsSection';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ParametresNotificationsPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const recipients = await loadNotificationRecipients(createServiceClient(), tenant.id);

  return (
    <SettingsPageShell sectionKey="notifications" description="Choisissez qui reçoit chaque notification interne par email.">
      <NotificationRecipientsSection initialRecipients={recipients} />
    </SettingsPageShell>
  );
}
