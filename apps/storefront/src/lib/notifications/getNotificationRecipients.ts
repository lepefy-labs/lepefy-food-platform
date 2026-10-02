import type { SupabaseClient } from '@supabase/supabase-js';
import type { NotificationTypeKey } from '@/lib/notifications/notificationTypes';

export type { NotificationTypeKey } from '@/lib/notifications/notificationTypes';

// Best-effort : une erreur ici ne doit jamais bloquer le flux appelant.
// Lookup unique (RPC notification_recipient_emails, migration 143) : destinataire
// actif, abonné au type, et membre de l'équipe lié encore actif le cas échéant.
export async function getNotificationRecipients(
  supabase: SupabaseClient,
  tenantId: string,
  type: NotificationTypeKey,
): Promise<string[]> {
  const { data, error } = await supabase.rpc('notification_recipient_emails', {
    p_tenant_id: tenantId,
    p_type_key: type,
    p_channel: 'email',
  });

  if (error) {
    console.error('[getNotificationRecipients] supabase error:', error, '— tenant:', tenantId, '— type:', type);
    return [];
  }

  return ((data ?? []) as Array<{ email: string }>).map((row) => row.email);
}
