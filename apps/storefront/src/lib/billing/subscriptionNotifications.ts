import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { getNotificationRecipients } from '@/lib/notifications/getNotificationRecipients';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { deliverEmail, emailRequest } from '@/lib/notifications/sendEmail';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { dispatchTenantNotification } from '@/lib/notifications/staff/dispatcher';
import { subscriptionBillingAlert } from '@/lib/notifications/staff/staffMessages';
import {
  PLATFORM_EMAIL_CONTEXT,
  subscriptionPaymentReceivedEmail,
  subscriptionPlatformAlertEmail,
  subscriptionStripeIssueEmail,
} from '@/lib/notifications/customerEmails';
import { describeDue, type ReminderDecision } from './subscriptionReminders';
import { formatBillingDate, paymentSourceLabel, type SubscriptionRow } from './subscriptionRules';

/**
 * Subscription notifications on the existing infrastructure (type
 * subscription_billing: delivery ledger, opted-in recipients, staff WhatsApp).
 * Never blocking: a payment is recorded before anything is sent.
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Subscribed recipients, falling back to the tenant's active administrators. */
export async function subscriptionRecipients(db: ServiceClient, tenantId: string): Promise<string[]> {
  const subscribed = await getNotificationRecipients(db, tenantId, 'subscription_billing');
  if (subscribed.length > 0) return subscribed;
  // Nobody opted in yet (type added after the recipients were configured):
  // the tenant's active administrators still have to know.
  const { data } = await db.from('admin_users').select('email').eq('tenant_id', tenantId).eq('role', 'tenant_admin').eq('active', true);
  return [...new Set(((data ?? []) as Array<{ email: string | null }>).map((admin) => admin.email).filter((email): email is string => Boolean(email)))];
}

export function billingUrlFor(storefrontUrl: string | null | undefined): string | null {
  return storefrontUrl ? `${storefrontUrl.replace(/\/$/, '')}/admin/billing` : null;
}


function formatAmount(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency || 'EUR' }).format(amountCents / 100);
}

export interface RecordedSubscriptionPayment {
  tenantId: string;
  paymentId: string;
  source: string;
  amountCents: number;
  currency: string;
  paidAt: string;
  paidUntil: string;
}

/**
 * Confirmation to the tenant once a payment is in the ledger (call it only
 * when the RPC reports created = true). Key per payment: a retry never sends
 * it twice. Never throws.
 */
export async function notifySubscriptionPayment(payment: RecordedSubscriptionPayment): Promise<void> {
  try {
    const db = createServiceClient();
    const [tenant, recipients] = await Promise.all([
      getTenantNotificationContext(payment.tenantId),
      subscriptionRecipients(db, payment.tenantId),
    ]);
    const paidUntil = formatBillingDate(payment.paidUntil);
    const key = `subscription-payment:${payment.paymentId}`;
    await dispatchTenantNotification({
      tenantId: payment.tenantId, eventType: 'subscription_billing', entityType: 'tenant_subscription', entityId: payment.tenantId,
      occurrenceId: key, channels: ['whatsapp'],
      alert: subscriptionBillingAlert({ title: `Paiement de l’abonnement Lepefy reçu, merci`, text: `Abonnement payé jusqu’au ${paidUntil}. Aucune action nécessaire.`, urgent: false }),
    });
    if (recipients.length === 0) return;
    await deliverEmail({ ...PLATFORM_EMAIL_CONTEXT, tenantId: payment.tenantId }, {
      ...subscriptionPaymentReceivedEmail({
        tenantName: tenant?.tenantName ?? 'votre établissement',
        amount: formatAmount(payment.amountCents, payment.currency),
        method: paymentSourceLabel(payment.source),
        paidOn: formatBillingDate(payment.paidAt),
        paidUntil,
        billingUrl: billingUrlFor(tenant?.storefrontUrl),
      }),
      notificationType: 'subscription_billing',
      idempotencyKey: key,
      recipients,
    });
  } catch (error) {
    console.error('[billing] payment confirmation failed:', error instanceof Error ? error.message.slice(0, 120) : 'unknown');
  }
}

/** Lepefy addresses (SUPPORT_NOTIFY_EMAILS), never written to the tenant's delivery history. */
function platformRecipients(): string[] {
  return (process.env.SUPPORT_NOTIFY_EMAILS ?? '').split(',').map((value) => value.trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)).slice(0, 10);
}

/**
 * Lepefy is told when a Stripe SaaS payment event renewed nothing (unpaid,
 * failed, wrong amount or currency, test mode, no subscription). Stripe does
 * not redeliver an event answered with 2xx, so this is sent once. Never throws.
 */
export async function notifyPlatformOfSaasPaymentIssue(input: {
  tenantSlug: string; reason: string; eventType: string; sessionId: string;
  amountCents: number | null; currency: string | null; livemode: boolean;
}): Promise<void> {
  const recipients = platformRecipients();
  if (recipients.length === 0) {
    console.warn('[billing] SaaS payment issue (no SUPPORT_NOTIFY_EMAILS):', input.tenantSlug, input.sessionId);
    return;
  }
  try {
    const base = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
    const rendered = subscriptionStripeIssueEmail({
      tenantSlug: input.tenantSlug,
      reason: input.reason,
      eventType: input.eventType,
      sessionId: input.sessionId,
      amount: input.amountCents === null ? '—' : formatAmount(input.amountCents, (input.currency || 'EUR').toUpperCase()),
      livemode: input.livemode,
      consoleUrl: base ? `${base}/admin/platform/abonnements` : null,
    });
    const [path, payload] = emailRequest({ ...PLATFORM_EMAIL_CONTEXT, tenantId: '' }, {
      ...rendered,
      notificationType: 'subscription_platform',
      idempotencyKey: `platform-saas-stripe:${input.sessionId}:${input.eventType}`.slice(0, 200),
      recipients,
    });
    await notifyN8n(path, payload);
  } catch (error) {
    console.error('[billing] platform Stripe alert failed:', error instanceof Error ? error.message.slice(0, 120) : 'unknown');
  }
}

/**
 * Lepefy is told when a tenant's payment is due today or still missing. The
 * caller sends it only on the run that sends the tenant's reminder for the
 * first time, so the hourly scheduler never repeats it. Never throws.
 */
export async function notifyPlatformOfDueReminder(tenantId: string, decision: ReminderDecision, row: SubscriptionRow): Promise<void> {
  const recipients = platformRecipients();
  if (recipients.length === 0) return;
  try {
    const tenant = await getTenantNotificationContext(tenantId);
    const base = (process.env.NEXT_PUBLIC_APP_URL || tenant?.storefrontUrl || '').replace(/\/+$/, '');
    const rendered = subscriptionPlatformAlertEmail({
      tenantName: tenant?.tenantName ?? tenantId,
      tenantSlug: tenant?.tenantSlug ?? '',
      paidUntil: formatBillingDate(row.paid_until),
      dueWhen: describeDue(decision.daysToDue),
      overdue: decision.daysToDue < 0,
      mode: decision.suspendOn ? `automatique le ${formatBillingDate(decision.suspendOn)}` : 'manuelle (aucune suspension prévue)',
      consoleUrl: base ? `${base}/admin/platform/abonnements` : null,
    });
    const [path, payload] = emailRequest({ ...PLATFORM_EMAIL_CONTEXT, tenantId }, {
      ...rendered,
      notificationType: 'subscription_platform',
      idempotencyKey: `platform-${decision.idempotencyKey}`.slice(0, 200),
      recipients,
    });
    // No ledger: Lepefy addresses never land in the tenant's delivery history.
    await notifyN8n(path, payload);
  } catch (error) {
    console.error('[billing] platform reminder failed:', error instanceof Error ? error.message.slice(0, 120) : 'unknown');
  }
}
