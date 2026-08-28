import type { SupabaseClient } from '@supabase/supabase-js';

export type NotificationFlag =
  | 'notify_card_payment'
  | 'notify_external_payment_pending'
  | 'notify_order_stock_conflict'
  | 'notify_event_booking_closed_reports';

// Best-effort : une erreur ici ne doit jamais bloquer le flux appelant.
export async function getNotificationRecipients(
  supabase: SupabaseClient,
  tenantId: string,
  flag: NotificationFlag,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('tenant_notification_recipients')
    .select('email')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .eq(flag, true);

  if (error) {
    console.error('[getNotificationRecipients] supabase error:', error, '— tenant:', tenantId, '— flag:', flag);
    return [];
  }

  return (data ?? []).map((row) => row.email as string);
}
