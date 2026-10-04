import { createServiceClient } from '@/lib/supabase/server';
import { isMissingLifecycleSchema, isModuleKey, type ModuleKey, type SuspensionMode } from './subscriptionRules';

/**
 * Platform console data (platform_owner only, service role): every tenant
 * with its plan, subscription lifecycle, suspended modules and last payment.
 */

export interface PlatformSubscriptionRow {
  tenantId: string;
  slug: string;
  name: string;
  planName: string | null;
  monthlyPriceCents: number | null;
  currency: string;
  hasSubscription: boolean;
  status: string;
  paidUntil: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  suspensionMode: SuspensionMode;
  graceDays: number;
  stripePaymentLink: string | null;
  suspendedModules: Array<{ module: ModuleKey; reason: string; since: string }>;
  lastPayment: { paidAt: string; amountCents: number; source: string } | null;
}

export interface PlatformSubscriptionsData {
  schemaReady: boolean;
  rows: PlatformSubscriptionRow[];
}

// Not in the generated DB types yet (migration 144).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any;

export async function loadPlatformSubscriptions(): Promise<PlatformSubscriptionsData> {
  const db = createServiceClient() as LooseClient;
  const [tenants, plans, lifecycle] = await Promise.all([
    db.from('tenants').select('id, slug, name').order('name', { ascending: true }),
    db.from('platform_plans').select('id, name, monthly_price_cents, currency'),
    db.from('tenant_subscriptions')
      .select('tenant_id, plan_id, status, paid_until, stripe_payment_link, suspension_mode, grace_days, suspended_at, suspension_reason'),
  ]);
  if (tenants.error) throw new Error(tenants.error.message);

  let schemaReady = !lifecycle.error;
  let subscriptions = lifecycle.data ?? [];
  if (lifecycle.error) {
    if (!isMissingLifecycleSchema(lifecycle.error)) throw new Error(lifecycle.error.message);
    const base = await db.from('tenant_subscriptions').select('tenant_id, plan_id, status, paid_until, stripe_payment_link');
    subscriptions = base.data ?? [];
  }

  let modules: Array<{ tenant_id: string; module_key: string; reason: string; created_at: string }> = [];
  let payments: Array<{ tenant_id: string; paid_at: string; amount_cents: number; source: string }> = [];
  if (schemaReady) {
    const [moduleRes, paymentRes] = await Promise.all([
      db.from('tenant_module_suspensions').select('tenant_id, module_key, reason, created_at'),
      db.from('tenant_subscription_payments').select('tenant_id, paid_at, amount_cents, source').order('paid_at', { ascending: false }).limit(500),
    ]);
    if (moduleRes.error || paymentRes.error) schemaReady = false;
    modules = moduleRes.data ?? [];
    payments = paymentRes.data ?? [];
  }

  const planById = new Map<string, { name: string; monthly_price_cents: number; currency: string }>(
    (plans.data ?? []).map((plan: { id: string; name: string; monthly_price_cents: number; currency: string }) => [plan.id, plan]),
  );
  const subByTenant = new Map<string, Record<string, unknown>>(subscriptions.map((s: Record<string, unknown>) => [s.tenant_id as string, s]));

  const rows: PlatformSubscriptionRow[] = (tenants.data ?? []).map((tenant: { id: string; slug: string; name: string }) => {
    const sub = subByTenant.get(tenant.id);
    const plan = sub ? planById.get(sub.plan_id as string) : undefined;
    const last = payments.find((payment) => payment.tenant_id === tenant.id);
    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      planName: plan?.name ?? null,
      monthlyPriceCents: plan ? Number(plan.monthly_price_cents) : null,
      currency: plan?.currency ?? 'EUR',
      hasSubscription: Boolean(sub),
      status: sub ? String(sub.status) : 'none',
      paidUntil: (sub?.paid_until as string | null) ?? null,
      suspendedAt: (sub?.suspended_at as string | null) ?? null,
      suspensionReason: (sub?.suspension_reason as string | null) ?? null,
      suspensionMode: sub?.suspension_mode === 'automatic' ? 'automatic' : 'manual',
      graceDays: typeof sub?.grace_days === 'number' ? sub.grace_days : 15,
      stripePaymentLink: (sub?.stripe_payment_link as string | null) ?? null,
      suspendedModules: modules
        .filter((m) => m.tenant_id === tenant.id && isModuleKey(m.module_key))
        .map((m) => ({ module: m.module_key as ModuleKey, reason: m.reason, since: m.created_at })),
      lastPayment: last ? { paidAt: last.paid_at, amountCents: last.amount_cents, source: last.source } : null,
    };
  });
  return { schemaReady, rows };
}

export interface SubscriptionHistory {
  payments: Array<{ id: string; source: string; amountCents: number; currency: string; paidAt: string; paidUntilBefore: string | null; paidUntilAfter: string; wasSuspended: boolean; note: string | null }>;
  audit: Array<{ id: string; action: string; moduleKey: string | null; reason: string | null; createdAt: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>;
}

export async function loadSubscriptionHistory(tenantId: string, limit = 50): Promise<SubscriptionHistory> {
  const db = createServiceClient() as LooseClient;
  const [payments, audit] = await Promise.all([
    db.from('tenant_subscription_payments')
      .select('id, source, amount_cents, currency, paid_at, paid_until_before, paid_until_after, was_suspended, note')
      .eq('tenant_id', tenantId).order('paid_at', { ascending: false }).limit(limit),
    db.from('tenant_subscription_audit')
      .select('id, action, module_key, reason, created_at, before_state, after_state')
      .eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(limit),
  ]);
  if (payments.error && !isMissingLifecycleSchema(payments.error)) throw new Error(payments.error.message);
  if (audit.error && !isMissingLifecycleSchema(audit.error)) throw new Error(audit.error.message);
  return {
    payments: (payments.data ?? []).map((p: Record<string, unknown>) => ({
      id: p.id as string, source: p.source as string, amountCents: Number(p.amount_cents), currency: (p.currency as string) ?? 'EUR',
      paidAt: p.paid_at as string, paidUntilBefore: (p.paid_until_before as string | null) ?? null,
      paidUntilAfter: p.paid_until_after as string, wasSuspended: Boolean(p.was_suspended), note: (p.note as string | null) ?? null,
    })),
    audit: (audit.data ?? []).map((a: Record<string, unknown>) => ({
      id: a.id as string, action: a.action as string, moduleKey: (a.module_key as string | null) ?? null, reason: (a.reason as string | null) ?? null,
      createdAt: a.created_at as string, before: (a.before_state as Record<string, unknown> | null) ?? null, after: (a.after_state as Record<string, unknown> | null) ?? null,
    })),
  };
}

/** Tenant-facing: last payments of one tenant (empty without migration 144). */
export async function loadTenantPayments(tenantId: string, limit = 6): Promise<SubscriptionHistory['payments']> {
  try {
    return (await loadSubscriptionHistory(tenantId, limit)).payments;
  } catch (error) {
    console.warn('[billing] payments unavailable', error);
    return [];
  }
}
