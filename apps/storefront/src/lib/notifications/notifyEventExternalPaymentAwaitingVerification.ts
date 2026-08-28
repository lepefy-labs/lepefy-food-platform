import type { SupabaseClient } from '@supabase/supabase-js';
import { getEventsBaseUrl } from '@/lib/events/ticketUrl';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { getNotificationRecipients } from '@/lib/notifications/getNotificationRecipients';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';

interface EventExternalPaymentNotificationItem {
  ticketTypeId: string;
  name: string;
  price: number;
  quantity: number;
}

export async function notifyEventExternalPaymentAwaitingVerification({
  supabase,
  tenantId,
  requestId,
  event,
  customer,
  paymentMethod,
  amount,
  currency,
  items,
  createdAt,
}: {
  supabase: SupabaseClient;
  tenantId: string;
  requestId: string;
  event: { id: string; title: string; dateStart: string; location: string | null };
  customer: { fullName: string; email: string; phone: string | null };
  paymentMethod: { type: string; label: string };
  amount: number;
  currency: string;
  items: EventExternalPaymentNotificationItem[];
  createdAt: string;
}): Promise<boolean> {
  try {
    const recipients = await getNotificationRecipients(supabase, tenantId, 'notify_external_payment_pending');
    if (recipients.length === 0) return false;

    const tenantContext = await getTenantNotificationContext(tenantId);
    if (!tenantContext) return false;

    const eventsUrl = getEventsBaseUrl().replace(/\/$/, '');
    const adminPaymentLink = tenantContext.storefrontUrl
      ? `${tenantContext.storefrontUrl.replace(/\/$/, '')}/admin/evenementiel/paiements-en-attente/${requestId}`
      : null;

    return await notifyN8n('/webhook/event-external-payment-awaiting-verification', {
      ...tenantContext,
      eventsUrl,
      notificationType: 'event_external_payment_awaiting_verification',
      recipients,
      requestId,
      paymentReference: `#${requestId.slice(0, 8).toUpperCase()}`,
      event,
      customer,
      paymentMethod,
      amount,
      currency: currency.toUpperCase(),
      quantityTotal: items.reduce((sum, item) => sum + Number(item.quantity), 0),
      items,
      adminPaymentLink,
      createdAt,
      notificationSentAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[event external payment tenant notification] unexpected failure:', error, '— request:', requestId);
    return false;
  }
}
