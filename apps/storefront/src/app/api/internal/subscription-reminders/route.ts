import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getNotificationRecipients } from '@/lib/notifications/getNotificationRecipients';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { deliverEmail } from '@/lib/notifications/sendEmail';
import { PLATFORM_EMAIL_CONTEXT, subscriptionReminderEmail } from '@/lib/notifications/customerEmails';
import { reminderDates, runSubscriptionReminders, type ReminderTenant } from '@/lib/billing/subscriptionReminders';
import { isMissingLifecycleSchema, type SubscriptionRow } from '@/lib/billing/subscriptionRules';
import { revalidateServiceState } from '@/lib/billing/tenantServiceState';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Hourly scheduler entry point (n8n, ops/n8n/subscription-reminders.json):
 * warnings before an automatic suspension and suspension notices
 * (lib/billing/subscriptionReminders.ts). Idempotent through the delivery
 * ledger, so running it every hour sends nothing twice. Also drops the
 * storefront cache of a tenant whose automatic suspension just started.
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

  const recipients = async (tenantId: string): Promise<string[]> => {
    const subscribed = await getNotificationRecipients(db, tenantId, 'subscription_billing');
    if (subscribed.length > 0) return subscribed;
    // Nobody opted in yet (type added after the recipients were configured):
    // the tenant's active administrators still have to know.
    const { data } = await db.from('admin_users').select('email').eq('tenant_id', tenantId).eq('role', 'tenant_admin').eq('active', true);
    return [...new Set(((data ?? []) as Array<{ email: string | null }>).map((admin) => admin.email).filter((email): email is string => Boolean(email)))];
  };

  const send: Parameters<typeof runSubscriptionReminders>[0]['send'] = async (tenantId, decision, to, row) => {
    const tenant = await getTenantNotificationContext(tenantId);
    const dates = reminderDates(decision, row);
    const billingUrl = tenant?.storefrontUrl ? `${tenant.storefrontUrl.replace(/\/$/, '')}/admin/billing` : null;
    return deliverEmail({ ...PLATFORM_EMAIL_CONTEXT, tenantId }, {
      ...subscriptionReminderEmail({
        tenantName: tenant?.tenantName ?? 'votre établissement',
        kind: decision.kind,
        daysLeft: decision.daysLeft,
        suspendOn: dates.suspendOn,
        paidUntil: dates.paidUntil,
        billingUrl,
      }),
      notificationType: 'subscription_billing',
      idempotencyKey: decision.idempotencyKey,
      recipients: to,
    });
  };

  try {
    const outcomes = await runSubscriptionReminders({ listTenants, recipients, send, invalidate: revalidateServiceState });
    return NextResponse.json({ outcomes }, { status: outcomes.failed > 0 ? 503 : 200 });
  } catch (error) {
    const missing = isMissingLifecycleSchema(error as { code?: string; message?: string });
    console.error('[subscription reminders] run failed', missing ? '(migration 144 not applied)' : '', error);
    return NextResponse.json({ error: missing ? 'Subscription schema unavailable' : 'Run failed' }, { status: 503 });
  }
}
