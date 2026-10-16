import type { SupabaseClient } from '@supabase/supabase-js';
import { attemptQueuedDelivery, type DeliveryOutcome } from '@/lib/notifications/deliveryLedger';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { routeDelivery } from '@/lib/notifications/deliveryRouter';
import type { NotificationChannel } from '@/lib/notifications/notificationTypes';
import { readGreenApiOutboundConfig } from '@/lib/notifications/providers/greenApiOutbound';
import { buildDeliveryRow, recordNotificationEvent } from './dispatcher';
import { testAlert } from './staffMessages';
import { maskWhatsappPhone } from './staffWhatsapp';

/**
 * Test message to ONE configured recipient on one channel, from the settings
 * page. Never another address than the recipient's own; « [TEST] » in the
 * message; at most one per recipient, channel and minute (ledger key).
 */
export const TEST_NOTIFICATION_TYPE = 'staff_test';

export type TestSendResult =
  | { ok: true; deliveryId: string; outcome: DeliveryOutcome | null }
  | { ok: false; status: number; error: string };

export async function sendRecipientTest(db: SupabaseClient, tenantId: string, recipientId: string, channel: NotificationChannel, now = new Date()): Promise<TestSendResult> {
  const { data: recipient } = await db.from('tenant_notification_recipients')
    .select('id, email, whatsapp_phone, active').eq('id', recipientId).eq('tenant_id', tenantId).maybeSingle();
  const row = recipient as { id: string; email: string | null; whatsapp_phone: string | null; active: boolean } | null;
  if (!row) return { ok: false, status: 404, error: 'Destinataire introuvable.' };
  const address = channel === 'email' ? row.email : row.whatsapp_phone;
  if (!address) return { ok: false, status: 400, error: channel === 'email' ? 'Ce destinataire n’a pas d’email.' : 'Ce destinataire n’a pas de numéro WhatsApp.' };
  if (channel === 'whatsapp' && !readGreenApiOutboundConfig().ok) {
    return { ok: false, status: 503, error: 'Le service WhatsApp Lepefy n’est pas configuré sur ce déploiement.' };
  }
  const context = await getTenantNotificationContext(tenantId);
  if (!context) return { ok: false, status: 503, error: 'Configuration de la boutique indisponible.' };

  const minute = now.toISOString().slice(0, 16);
  const alert = testAlert(channel === 'email' ? 'Email' : 'WhatsApp');
  const eventId = await recordNotificationEvent(db, {
    tenantId, eventType: TEST_NOTIFICATION_TYPE, entityType: 'notification_recipient', entityId: recipientId,
    occurrenceId: `${channel}:${minute}`, alert,
  });
  if (!eventId) return { ok: false, status: 500, error: 'Envoi de test impossible.' };
  const delivery = buildDeliveryRow({ tenantId, eventId, eventType: TEST_NOTIFICATION_TYPE, target: { recipientId, channel, address }, alert, context, now });
  if (channel === 'whatsapp') (delivery.payload as Record<string, unknown>).test = true;
  const { data, error } = await db.from('notification_deliveries')
    .upsert(delivery, { onConflict: 'tenant_id,idempotency_key', ignoreDuplicates: true }).select('id');
  if (error) return { ok: false, status: 500, error: 'Envoi de test impossible.' };
  const id = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!id) return { ok: false, status: 429, error: 'Un test vient d’être envoyé : réessayez dans une minute.' };
  return { ok: true, deliveryId: id, outcome: await attemptQueuedDelivery(db, id, routeDelivery) };
}

/**
 * Confirms a WhatsApp number after the admin saw the test message: allowed
 * only when a test to that number was accepted by the provider in the last
 * 24 hours.
 */
export async function confirmRecipientWhatsapp(db: SupabaseClient, tenantId: string, recipientId: string, now = new Date()): Promise<{ ok: boolean; status?: number; error?: string; verifiedAt?: string }> {
  const { data: recipient } = await db.from('tenant_notification_recipients')
    .select('id, whatsapp_phone').eq('id', recipientId).eq('tenant_id', tenantId).maybeSingle();
  const phone = (recipient as { whatsapp_phone: string | null } | null)?.whatsapp_phone ?? null;
  if (!recipient) return { ok: false, status: 404, error: 'Destinataire introuvable.' };
  if (!phone) return { ok: false, status: 400, error: 'Ce destinataire n’a pas de numéro WhatsApp.' };
  const { data: tests } = await db.from('notification_deliveries').select('id, recipients')
    .eq('tenant_id', tenantId).eq('recipient_id', recipientId).eq('channel', 'whatsapp').eq('notification_type', TEST_NOTIFICATION_TYPE)
    .in('status', ['accepted', 'delivered']).gte('accepted_at', new Date(now.getTime() - 86_400_000).toISOString()).limit(5);
  const masked = maskWhatsappPhone(phone);
  if (!((tests ?? []) as Array<{ recipients: string[] }>).some((test) => test.recipients?.includes(masked))) {
    return { ok: false, status: 409, error: 'Envoyez d’abord un message de test à ce numéro.' };
  }
  const verifiedAt = now.toISOString();
  const { error } = await db.from('tenant_notification_recipients').update({ whatsapp_verified_at: verifiedAt })
    .eq('id', recipientId).eq('tenant_id', tenantId).eq('whatsapp_phone', phone);
  if (error) return { ok: false, status: 500, error: 'Confirmation impossible.' };
  return { ok: true, verifiedAt };
}
