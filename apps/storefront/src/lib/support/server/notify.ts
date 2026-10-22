import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { dispatchTenantNotification } from '@/lib/notifications/staff/dispatcher';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { emailRequest, sendTenantEmail } from '@/lib/notifications/sendEmail';
import { staffAlertEmail } from '@/lib/notifications/operationalEmails';
import { notifyN8n } from '@/lib/events/notifyN8n';
import type { StaffAlert } from '@/lib/notifications/staff/staffMessages';
import { SUPPORT_TENANT_STATUS_META } from '@/lib/admin/statusRegistry';
import { supportReference } from '../domain';
import { notificationWindow, tenantStatus } from '../rules';
import type { SupportStatus } from '../domain';

/**
 * Assistance notifications on the existing infrastructure — never a second
 * system, never blocking: the request is saved before anything is sent and a
 * transport failure only leaves a queued/failed delivery.
 *
 * Shop: type `support_reply` of the notification catalogue (dispatcher: event
 * + delivery ledger + retries, e-mail and staff WhatsApp for the subscribed
 * recipients) and the requester's own e-mail when they are not subscribed.
 * One message per request and per 15-minute window: a burst of replies is one
 * notification.
 *
 * Lepefy: optional e-mail to SUPPORT_NOTIFY_EMAILS (comma-separated), outside
 * the shop's delivery ledger so the shop never sees Lepefy's addresses.
 */

export type TenantUpdateKind = 'reply' | 'waiting' | 'resolved';

interface TicketFacts { id: string; tenant_id: string; number: number; title: string; status: SupportStatus; requester_admin_id: string | null; visible_to_tenant: boolean }

async function ticketFacts(ticketId: string): Promise<TicketFacts | null> {
  const { data } = await createServiceClient().from('support_tickets')
    .select('id, tenant_id, number, title, status, requester_admin_id, visible_to_tenant').eq('id', ticketId).maybeSingle();
  return (data as TicketFacts | null) ?? null;
}

const KIND_TITLE: Record<TenantUpdateKind, string> = {
  reply: 'L’équipe Lepefy vous a répondu',
  waiting: 'L’équipe Lepefy attend votre réponse',
  resolved: 'Votre demande d’assistance est terminée',
};

export function tenantUpdateAlert(ticket: Pick<TicketFacts, 'id' | 'number' | 'title' | 'status'>, kind: TenantUpdateKind): StaffAlert {
  return {
    kind: 'support_reply',
    priority: 'normal',
    title: KIND_TITLE[kind],
    indicators: [],
    details: [
      ['Demande', `${supportReference(ticket.number)} · ${ticket.title}`],
      ['Statut', SUPPORT_TENANT_STATUS_META[tenantStatus(ticket.status)]?.label ?? 'En cours'],
    ],
    action: kind === 'resolved' ? 'Dites-nous si le problème est bien résolu.' : 'Ouvrez la conversation pour lire le message.',
    link: { label: 'Voir la conversation', path: `/admin/assistance/${ticket.id}` },
    note: null,
  };
}

export async function notifyTenantOfUpdate(ticketId: string, kind: TenantUpdateKind, now = new Date()): Promise<void> {
  try {
    const ticket = await ticketFacts(ticketId);
    if (!ticket || !ticket.visible_to_tenant) return;
    const alert = tenantUpdateAlert(ticket, kind);
    const occurrence = `${kind === 'resolved' ? 'resolved' : 'update'}:${notificationWindow(now)}`;
    const result = await dispatchTenantNotification({
      tenantId: ticket.tenant_id, eventType: 'support_reply', entityType: 'support_ticket', entityId: ticket.id,
      occurrenceId: occurrence, alert, facts: { number: ticket.number, kind },
    });

    // The person who asked is told even without a subscription (once per window).
    if (!ticket.requester_admin_id) return;
    const db = createServiceClient();
    const { data: requester } = await db.from('admin_users').select('email, active').eq('id', ticket.requester_admin_id).maybeSingle();
    const email = (requester as { email?: string | null; active?: boolean } | null)?.active ? (requester as { email?: string | null }).email?.trim().toLowerCase() : null;
    if (!email) return;
    const { data: targets } = await db.rpc('notification_recipient_targets', { p_tenant_id: ticket.tenant_id, p_type_keys: ['support_reply'], p_channel: 'email' });
    const subscribed = ((targets ?? []) as Array<{ address: string | null }>).some((row) => row.address?.trim().toLowerCase() === email);
    if (subscribed && !result.error) return;
    await sendTenantEmail({
      tenantId: ticket.tenant_id,
      notificationType: 'support_reply',
      idempotencyKey: `support:${ticket.id}:${occurrence}:requester`,
      recipients: [email],
      render: (context) => staffAlertEmail(context, alert),
    });
  } catch (error) {
    console.error('[support] tenant notification failed:', error instanceof Error ? error.message.slice(0, 120) : 'unknown');
  }
}

export type PlatformEventKind = 'created' | 'tenant_message' | 'reopened';

const PLATFORM_TITLE: Record<PlatformEventKind, string> = {
  created: 'Nouvelle demande d’assistance',
  tenant_message: 'Nouveau message d’une boutique',
  reopened: 'Demande rouverte par la boutique',
};

function platformRecipients(): string[] {
  return (process.env.SUPPORT_NOTIFY_EMAILS ?? '').split(',').map((value) => value.trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)).slice(0, 10);
}

export async function notifyPlatform(ticketId: string, kind: PlatformEventKind, now = new Date()): Promise<void> {
  const recipients = platformRecipients();
  if (recipients.length === 0) return;
  try {
    const ticket = await ticketFacts(ticketId);
    if (!ticket) return;
    const context = await getTenantNotificationContext(ticket.tenant_id);
    if (!context) return;
    const base = (process.env.NEXT_PUBLIC_APP_URL || context.storefrontUrl || '').replace(/\/+$/, '');
    const alert: StaffAlert = {
      kind: 'support_platform',
      priority: 'normal',
      title: `${PLATFORM_TITLE[kind]} · ${context.tenantName}`,
      indicators: [],
      details: [['Boutique', context.tenantName], ['Demande', `${supportReference(ticket.number)} · ${ticket.title}`]],
      action: 'Répondre depuis la console Assistance tenants.',
      link: null,
      note: base ? `${base}/admin/platform/assistance/${ticket.id}` : null,
    };
    const rendered = staffAlertEmail(context, alert);
    const [path, payload] = emailRequest(context, {
      ...rendered,
      subject: `[Assistance] ${context.tenantName} · ${supportReference(ticket.number)} · ${ticket.title}`.slice(0, 200),
      notificationType: 'support_platform',
      idempotencyKey: `support-platform:${ticket.id}:${kind}:${notificationWindow(now)}`,
      recipients,
    });
    // No ledger: Lepefy addresses never land in the shop's delivery history.
    await notifyN8n(path, payload);
  } catch (error) {
    console.error('[support] platform notification failed:', error instanceof Error ? error.message.slice(0, 120) : 'unknown');
  }
}
