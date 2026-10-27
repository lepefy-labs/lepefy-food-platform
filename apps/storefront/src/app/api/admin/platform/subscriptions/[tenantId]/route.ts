import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';
import { loadSubscriptionHistory } from '@/lib/billing/platformSubscriptions';
import { endOfDayUtc, platformSubscriptionActionSchema, recordPaymentIssue, transferPaidAt } from '@/lib/billing/platformSubscriptionActions';
import { subscriptionErrorMessage } from '@/lib/billing/subscriptionRules';
import { revalidateServiceState } from '@/lib/billing/tenantServiceState';
import { revalidateTenantCache } from '@/lib/cache/storefrontCache';
import { notifySubscriptionPayment } from '@/lib/billing/subscriptionNotifications';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Payments and audit of one tenant (platform_owner only). */
export async function GET(_req: NextRequest, { params }: { params: { tenantId: string } }) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  if (!UUID_RE.test(params.tenantId)) return NextResponse.json({ error: 'Tenant invalide.' }, { status: 400 });
  try {
    return NextResponse.json(await loadSubscriptionHistory(params.tenantId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[platform/subscriptions] history failed:', error);
    return NextResponse.json({ error: 'Historique indisponible.' }, { status: 500 });
  }
}

/**
 * Platform actions on one tenant: record a payment received outside Stripe
 * (bank transfer or PayPal, idempotent on requestKey, unique reference), suspend/reactivate,
 * correct the due date, payment link, automatic-suspension policy, module
 * suspension. Every write goes through the 144 RPCs (row lock + audit).
 */
export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  if (req.headers.get('origin') && req.headers.get('origin') !== req.nextUrl.origin) {
    return NextResponse.json({ error: 'Origine refusée.' }, { status: 403 });
  }
  if (!UUID_RE.test(params.tenantId)) return NextResponse.json({ error: 'Tenant invalide.' }, { status: 400 });

  const parsed = platformSubscriptionActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Paramètres invalides.' }, { status: 400 });
  }
  const actor = (await getCurrentAdminAccessContext(null))?.userId;
  if (!actor) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

  const input = parsed.data;
  if (input.action === 'record_payment') {
    const issue = recordPaymentIssue(input);
    if (issue) return NextResponse.json({ error: issue }, { status: 400 });
  }
  // record_transfer (144 form) = a bank transfer without reference nor key.
  const payment = input.action === 'record_payment' || input.action === 'record_transfer'
    ? {
        source: input.action === 'record_payment' ? input.method : 'bank_transfer',
        amountCents: Math.round(input.amountEur * 100),
        paidAt: transferPaidAt(input.paidOn),
        reference: input.action === 'record_payment' ? input.reference?.trim() || null : null,
        requestKey: input.action === 'record_payment' ? input.requestKey : null,
        note: input.note || null,
      }
    : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data, error } = payment
    ? await db.rpc('record_tenant_subscription_payment', {
        p_tenant_id: params.tenantId,
        p_source: payment.source,
        p_amount_cents: payment.amountCents,
        p_currency: 'EUR',
        p_paid_at: payment.paidAt,
        p_stripe_session_id: null,
        p_note: payment.note,
        p_actor: actor,
        p_external_reference: payment.reference,
        p_request_key: payment.requestKey,
      })
    : await db.rpc('admin_update_tenant_subscription', {
        p_tenant_id: params.tenantId,
        p_action: input.action,
        p_actor: actor,
        p_reason: 'reason' in input ? input.reason : null,
        p_paid_until: input.action === 'set_paid_until' ? endOfDayUtc(input.paidUntil) : null,
        p_payment_link: input.action === 'set_payment_link' ? input.url : null,
        p_mode: input.action === 'set_suspension_policy' ? input.mode : null,
        p_grace_days: input.action === 'set_suspension_policy' ? input.graceDays : null,
        p_module_key: input.action === 'suspend_module' || input.action === 'reactivate_module' ? input.module : null,
      });

  if (error) {
    console.error('[platform/subscriptions] action failed:', input.action, error);
    return NextResponse.json({ error: subscriptionErrorMessage(error) }, { status: 409 });
  }

  revalidateServiceState(params.tenantId);
  revalidateTenantCache();
  const row = Array.isArray(data) ? data[0] : null;
  // Confirmation to the tenant, once per recorded payment (a retry with the same key gets created = false).
  if (payment && row?.out_created && row.out_payment_id) {
    await notifySubscriptionPayment({
      tenantId: params.tenantId, paymentId: row.out_payment_id, source: payment.source, amountCents: payment.amountCents,
      currency: 'EUR', paidAt: payment.paidAt, paidUntil: row.out_paid_until,
    });
  }
  return NextResponse.json({ ok: true, paidUntil: row?.out_paid_until ?? null, created: payment ? Boolean(row?.out_created) : undefined });
}
