import type { createServiceClient } from '@/lib/supabase/server';
import { isMissingLifecycleSchema } from './subscriptionRules';
import { revalidateServiceState } from './tenantServiceState';
import { notifySubscriptionPayment } from './subscriptionNotifications';

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface SaasPaymentInput {
  tenantSlug: string;
  stripeSessionId: string;
  /** Stripe event that confirmed the payment (kept for tracing, migration 169). */
  stripeEventId?: string;
  amountCents: number;
  currency: string;
  paidAt: Date;
}

export type SaasPaymentOutcome =
  | { ok: true; mode: 'ledger'; tenantId: string; paidUntil: string; created: boolean }
  | { ok: true; mode: 'legacy'; tenantId: string; paidUntil: string }
  | { ok: false; reason: 'tenant_not_found' | 'db_error' };

interface PaymentRpcRow {
  out_payment_id: string;
  out_created: boolean;
  out_paid_until: string;
  out_was_suspended: boolean;
}

export interface SaasTenantLookup {
  tenantId: string;
  isTest: boolean;
  plan: { monthlyPriceCents: number; currency: string } | null;
}

/**
 * Tenant of a SaaS payment (by the Payment Link's tenant_slug), its test flag
 * and the plan of its subscription (null without a tenant_subscriptions row),
 * for the checks of lib/billing/saasStripeEvent.ts.
 */
export async function loadSaasTenant(db: ServiceClient, tenantSlug: string): Promise<SaasTenantLookup | 'not_found' | 'db_error'> {
  const { data: tenant, error } = await db.from('tenants').select('id, is_test').eq('slug', tenantSlug).maybeSingle();
  if (error) return 'db_error';
  if (!tenant) return 'not_found';
  const row = tenant as { id: string; is_test: boolean | null };
  const { data: sub, error: subError } = await db.from('tenant_subscriptions')
    .select('platform_plans(monthly_price_cents, currency)').eq('tenant_id', row.id).maybeSingle();
  if (subError) return 'db_error';
  const plan = (sub as { platform_plans: { monthly_price_cents: number; currency: string } | null } | null)?.platform_plans ?? null;
  return {
    tenantId: row.id,
    isTest: Boolean(row.is_test),
    plan: plan ? { monthlyPriceCents: Number(plan.monthly_price_cents), currency: plan.currency || 'EUR' } : null,
  };
}

/**
 * SaaS card payment (Stripe Payment Link, metadata.type = saas_subscription),
 * once the webhook has checked it (lib/billing/saasStripeEvent.ts).
 *
 * With migration 144: record_tenant_subscription_payment applies the renewal
 * rule (end of the month after the paid month, or end of the payment month
 * after a suspension) and is idempotent on the checkout session, so a webhook
 * retry never extends twice. Without it (or without a tenant_subscriptions
 * row): the previous behaviour, legacy columns +30 days from the payment.
 */
export async function recordSaasSubscriptionPayment(db: ServiceClient, input: SaasPaymentInput): Promise<SaasPaymentOutcome> {
  const { data: tenant, error: tenantError } = await db.from('tenants').select('id').eq('slug', input.tenantSlug).maybeSingle();
  if (tenantError) return { ok: false, reason: 'db_error' };
  if (!tenant) return { ok: false, reason: 'tenant_not_found' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any).rpc('record_tenant_subscription_payment', {
    p_tenant_id: tenant.id,
    p_source: 'stripe',
    p_amount_cents: Math.max(0, Math.round(input.amountCents)),
    p_currency: input.currency.toUpperCase(),
    p_paid_at: input.paidAt.toISOString(),
    p_stripe_session_id: input.stripeSessionId,
    p_note: null,
    p_actor: null,
    p_stripe_event_id: input.stripeEventId ?? null,
  });

  if (!error && Array.isArray(data) && data[0]) {
    const row = data[0] as PaymentRpcRow;
    revalidateServiceState(tenant.id);
    // Confirmation to the tenant, once per payment (never on a webhook retry).
    if (row.out_created) {
      await notifySubscriptionPayment({
        tenantId: tenant.id, paymentId: row.out_payment_id, source: 'stripe', amountCents: Math.max(0, Math.round(input.amountCents)),
        currency: input.currency.toUpperCase(), paidAt: input.paidAt.toISOString(), paidUntil: row.out_paid_until,
      });
    }
    return { ok: true, mode: 'ledger', tenantId: tenant.id, paidUntil: row.out_paid_until, created: row.out_created };
  }

  if (error && !isMissingLifecycleSchema(error) && error.message?.trim() !== 'subscription_not_found') {
    console.error('[billing] record_tenant_subscription_payment failed:', error);
    return { ok: false, reason: 'db_error' };
  }

  // Compatibility path (no 144 or no subscription row): unchanged behaviour.
  const paidUntil = new Date(input.paidAt);
  paidUntil.setDate(paidUntil.getDate() + 30);
  const { error: legacyError } = await db
    .from('tenants')
    .update({
      subscription_status: 'active',
      subscription_paid_until: paidUntil.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', tenant.id);
  if (legacyError) {
    console.error('[billing] legacy subscription update failed:', legacyError);
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true, mode: 'legacy', tenantId: tenant.id, paidUntil: paidUntil.toISOString() };
}
