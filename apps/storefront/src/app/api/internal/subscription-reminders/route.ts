import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { deliverEmail } from '@/lib/notifications/sendEmail';
import { PLATFORM_EMAIL_CONTEXT, subscriptionReminderEmail } from '@/lib/notifications/customerEmails';
import {
  describeDue,
  PLATFORM_ALERT_KINDS,
  reminderDates,
  runSubscriptionReminders,
  type ReminderDecision,
  type ReminderTenant,
} from '@/lib/billing/subscriptionReminders';
import { coveredMonth, formatBillingMonth, isMissingLifecycleSchema, type SubscriptionRow } from '@/lib/billing/subscriptionRules';
import { billingUrlFor, notifyPlatformOfDueReminder, subscriptionRecipients } from '@/lib/billing/subscriptionNotifications';
import { revalidateServiceState } from '@/lib/billing/tenantServiceState';
import { dispatchTenantNotification } from '@/lib/notifications/staff/dispatcher';
import { subscriptionBillingAlert } from '@/lib/notifications/staff/staffMessages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function whatsappAlert(decision: ReminderDecision, dates: { suspendOn: string; paidUntil: string }) {
  if (decision.kind === 'suspended') {
    return subscriptionBillingAlert({ title: 'Abonnement Lepefy suspendu', text: 'La boutique est hors ligne : régler l’abonnement pour rétablir le service.', urgent: true });
  }
  if (decision.kind === 'd7' || decision.kind === 'd1') {
    const when = decision.daysLeft <= 0 ? 'aujourd’hui' : decision.daysLeft === 1 ? 'demain' : `dans ${decision.daysLeft} jours`;
    return subscriptionBillingAlert({ title: `Abonnement Lepefy : suspension ${when} (${dates.suspendOn})`, text: 'Régler l’abonnement pour éviter la suspension de la boutique.', urgent: decision.daysLeft <= 1 });
  }
  const overdue = decision.daysToDue < 0;
  return subscriptionBillingAlert({
    title: overdue ? `Abonnement Lepefy : paiement en retard (échéance du ${dates.paidUntil})` : `Abonnement Lepefy : échéance ${describeDue(decision.daysToDue)} (${dates.paidUntil})`,
    text: 'Régler l’abonnement depuis la page Abonnement (carte ou virement).',
    urgent: overdue,
  });
}

/**
 * Hourly scheduler entry point (n8n, ops/n8n/subscription-reminders.json):
 * due-date reminders (every mode), warnings before an automatic suspension
 * and suspension notices (lib/billing/subscriptionReminders.ts). Idempotent
 * through the delivery ledger, so running it every hour sends nothing twice.
 * Also drops the storefront cache of a tenant whose automatic suspension just
 * started.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.SUBSCRIPTION_REMINDERS_CRON_SECRET ?? '';
  const provided = request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? '';
  if (!secret || !provided || Buffer.byteLength(secret) !== Buffer.byteLength(provided)
    || !timingSafeEqual(Buffer.from(secret), Buffer.from(provided))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = createServiceClient();
  // Not in the generated DB types yet (migration 144).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loose = db as any;

  const listTenants = async (): Promise<ReminderTenant[]> => {
    const { data, error } = await loose
      .from('tenant_subscriptions')
      .select('tenant_id, status, suspended_at, suspension_mode, paid_until, grace_days');
    if (error) throw error;
    return (data ?? []).map((row: SubscriptionRow & { tenant_id: string }) => ({ tenantId: row.tenant_id, row }));
  };

  /** Status of an already recorded delivery, or null on the first attempt for this key. */
  const recordedStatus = async (tenantId: string, key: string): Promise<string | null> => {
    const { data } = await db.from('notification_deliveries').select('status').eq('tenant_id', tenantId).eq('idempotency_key', key).maybeSingle();
    return (data as { status: string } | null)?.status ?? null;
  };

  const send: Parameters<typeof runSubscriptionReminders>[0]['send'] = async (tenantId, decision, to, row) => {
    // Already handled by an earlier run (accepted, or retried by the ledger's
    // own schedule): nothing more to send, Lepefy already knows.
    const existing = await recordedStatus(tenantId, decision.idempotencyKey);
    if (existing) return existing === 'accepted' || existing === 'delivered';

    const tenant = await getTenantNotificationContext(tenantId);
    const dates = reminderDates(decision, row);
    // WhatsApp de l'équipe (opt-in, numéro confirmé) : même clé que l'email, donc une seule fois.
    await dispatchTenantNotification({
      tenantId, eventType: 'subscription_billing', entityType: 'tenant_subscription', entityId: tenantId,
      occurrenceId: decision.idempotencyKey.slice(0, 120), channels: ['whatsapp'],
      alert: whatsappAlert(decision, dates),
    });
    const accepted = await deliverEmail({ ...PLATFORM_EMAIL_CONTEXT, tenantId }, {
      ...subscriptionReminderEmail({
        tenantName: tenant?.tenantName ?? 'votre établissement',
        kind: decision.kind,
        daysLeft: decision.daysLeft,
        suspendOn: decision.suspendOn ? dates.suspendOn : '',
        paidUntil: dates.paidUntil,
        billingUrl: billingUrlFor(tenant?.storefrontUrl),
        dueWhen: describeDue(decision.daysToDue),
        coveredMonth: formatBillingMonth(coveredMonth(row)),
      }),
      notificationType: 'subscription_billing',
      idempotencyKey: decision.idempotencyKey,
      recipients: to,
    });
    if (PLATFORM_ALERT_KINDS.includes(decision.kind)) await notifyPlatformOfDueReminder(tenantId, decision, row);
    return accepted;
  };

  try {
    const outcomes = await runSubscriptionReminders({
      listTenants,
      recipients: (tenantId) => subscriptionRecipients(db, tenantId),
      send,
      invalidate: revalidateServiceState,
    });
    return NextResponse.json({ outcomes }, { status: outcomes.failed > 0 ? 503 : 200 });
  } catch (error) {
    const missing = isMissingLifecycleSchema(error as { code?: string; message?: string });
    console.error('[subscription reminders] run failed', missing ? '(migration 144 not applied)' : '', error);
    return NextResponse.json({ error: missing ? 'Subscription schema unavailable' : 'Run failed' }, { status: 503 });
  }
}
