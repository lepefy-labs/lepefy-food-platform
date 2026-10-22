import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { availableNotificationTypes, notificationTypeContext } from '@/lib/notifications/notificationTypes';
import { readGreenApiOutboundConfig } from '@/lib/notifications/providers/greenApiOutbound';
import { STAFF_WHATSAPP_FLAG } from '@/lib/notifications/staff/staffWhatsapp';
import { SUPPORT_FLAG } from '@/lib/support/domain';
import { SettingsPageShell } from '../_components/SettingsPageShell';
import { loadNotificationRecipients, loadNotificationTeam } from '../_components/loadSettingsData';
import { NotificationRecipientsSection } from '../NotificationRecipientsSection';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function ParametresNotificationsPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const db = createServiceClient();
  const [recipients, team, whatsappEnabled, supportEnabled] = await Promise.all([
    loadNotificationRecipients(db, tenant.id),
    loadNotificationTeam(db, tenant.id),
    isFeatureEnabled(tenant.id, STAFF_WHATSAPP_FLAG),
    isFeatureEnabled(tenant.id, SUPPORT_FLAG),
  ]);
  // Only the types of the tenant's modules are shown; hidden subscriptions are kept as-is.
  const typeKeys = availableNotificationTypes(notificationTypeContext(tenant, { support: supportEnabled })).map((type) => type.key);

  return (
    <SettingsPageShell sectionKey="notifications" description="Choisissez qui reçoit chaque notification interne, par email et par WhatsApp.">
      <NotificationRecipientsSection initialRecipients={recipients} team={team} typeKeys={typeKeys}
        whatsapp={{ enabled: whatsappEnabled, configured: readGreenApiOutboundConfig().ok }} />
    </SettingsPageShell>
  );
}
