/**
 * Pure rules for the SaaS subscription branch of the Stripe webhook
 * (Payment Link, Checkout Session metadata.type = saas_subscription).
 *
 * A payment renews a tenant only when Stripe says the money is there
 * (payment_status = paid), from a live event (a test-mode event only for a
 * tenant flagged is_test, never from the separate e2e account), for at least
 * the plan's monthly price in the plan's currency. Anything else renews
 * nothing: Lepefy is told and records the payment by hand if it is real.
 */

export const SAAS_CHECKOUT_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
] as const;

export type SaasCheckoutEventType = (typeof SAAS_CHECKOUT_EVENTS)[number];

export function isSaasCheckoutEventType(type: string): type is SaasCheckoutEventType {
  return (SAAS_CHECKOUT_EVENTS as readonly string[]).includes(type);
}

export interface SaasSessionFacts {
  eventType: SaasCheckoutEventType;
  livemode: boolean;
  /** Event verified with the separate e2e Stripe account. */
  fromE2EAccount: boolean;
  metadataType: string | null | undefined;
  tenantSlug: string | null | undefined;
  /** 'paid' | 'unpaid' | 'no_payment_required' */
  paymentStatus: string | null | undefined;
  amountTotal: number | null | undefined;
  currency: string | null | undefined;
}

export type SaasRejectReason =
  | 'missing_tenant_slug'
  | 'unknown_tenant'
  | 'e2e_account'
  | 'async_payment_failed'
  | 'no_payment_required'
  | 'not_paid'
  | 'test_mode'
  | 'no_subscription'
  | 'currency_mismatch'
  | 'amount_too_low';

/** Step 1, before any read: does this event concern a SaaS payment, and can it be one? */
export type SaasPrecheck =
  | { action: 'ignore' }
  /** Asynchronous method (SEPA…) still pending: async_payment_succeeded will follow. */
  | { action: 'wait' }
  | { action: 'reject'; reason: SaasRejectReason; alert: boolean }
  | { action: 'continue'; tenantSlug: string };

export function precheckSaasEvent(facts: SaasSessionFacts): SaasPrecheck {
  if (facts.metadataType !== 'saas_subscription') return { action: 'ignore' };
  const tenantSlug = facts.tenantSlug?.trim();
  if (!tenantSlug) return { action: 'reject', reason: 'missing_tenant_slug', alert: true };
  // The e2e account is a test harness for storefront orders, never a way to pay Lepefy.
  if (facts.fromE2EAccount) return { action: 'reject', reason: 'e2e_account', alert: false };
  if (facts.eventType === 'checkout.session.async_payment_failed') return { action: 'reject', reason: 'async_payment_failed', alert: true };
  if (facts.paymentStatus === 'paid') return { action: 'continue', tenantSlug };
  if (facts.paymentStatus === 'no_payment_required') return { action: 'reject', reason: 'no_payment_required', alert: true };
  if (facts.eventType === 'checkout.session.completed') return { action: 'wait' };
  return { action: 'reject', reason: 'not_paid', alert: true };
}

export interface SaasTenantFacts {
  isTest: boolean;
  /** Plan of the tenant's subscription; null when the tenant has no tenant_subscriptions row. */
  plan: { monthlyPriceCents: number; currency: string } | null;
}

/** Step 2, once the tenant and its plan are read: may this payment renew it? */
export function checkSaasPayment(facts: SaasSessionFacts, tenant: SaasTenantFacts): { ok: true } | { ok: false; reason: SaasRejectReason } {
  if (!facts.livemode && !tenant.isTest) return { ok: false, reason: 'test_mode' };
  if (!tenant.plan) return { ok: false, reason: 'no_subscription' };
  if ((facts.currency ?? '').toUpperCase() !== tenant.plan.currency.toUpperCase()) return { ok: false, reason: 'currency_mismatch' };
  if (!Number.isFinite(facts.amountTotal) || (facts.amountTotal ?? 0) < tenant.plan.monthlyPriceCents) return { ok: false, reason: 'amount_too_low' };
  return { ok: true };
}

/** French wording for the Lepefy alert. */
export const SAAS_REJECT_MESSAGES: Record<SaasRejectReason, string> = {
  missing_tenant_slug: 'Le paiement ne porte pas de tenant (metadata tenant_slug absente du Payment Link).',
  unknown_tenant: 'Aucun tenant ne correspond au tenant_slug du Payment Link : abonnement non prolongé.',
  e2e_account: 'Évènement du compte Stripe de test e2e : ignoré.',
  async_payment_failed: 'Le paiement différé (prélèvement, virement Stripe…) a échoué : aucun montant reçu.',
  no_payment_required: 'Session sans paiement (code promotionnel à 100 % ou montant nul) : abonnement non prolongé.',
  not_paid: 'Stripe n’indique pas le paiement comme reçu : abonnement non prolongé.',
  test_mode: 'Évènement Stripe en mode test pour un tenant réel : abonnement non prolongé.',
  no_subscription: 'Ce tenant n’a pas d’abonnement (tenant_subscriptions) : paiement à rattacher à la main.',
  currency_mismatch: 'Devise différente de celle du plan : abonnement non prolongé.',
  amount_too_low: 'Montant inférieur au prix mensuel du plan : abonnement non prolongé.',
};
