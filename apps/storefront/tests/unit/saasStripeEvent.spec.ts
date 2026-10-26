import { expect, test } from '@playwright/test';
import {
  checkSaasPayment,
  isSaasCheckoutEventType,
  precheckSaasEvent,
  SAAS_REJECT_MESSAGES,
  type SaasSessionFacts,
  type SaasTenantFacts,
} from '../../src/lib/billing/saasStripeEvent';
import { subscriptionStripeIssueEmail } from '../../src/lib/notifications/customerEmails';

const paid = (patch: Partial<SaasSessionFacts> = {}): SaasSessionFacts => ({
  eventType: 'checkout.session.completed',
  livemode: true,
  fromE2EAccount: false,
  metadataType: 'saas_subscription',
  tenantSlug: 'chloefood',
  paymentStatus: 'paid',
  amountTotal: 8900,
  currency: 'eur',
  ...patch,
});
const chloe: SaasTenantFacts = { isTest: false, plan: { monthlyPriceCents: 8900, currency: 'EUR' } };

test.describe('SaaS Stripe events: which ones can renew', () => {
  test('only the three Checkout Session events are routed here', () => {
    expect(isSaasCheckoutEventType('checkout.session.completed')).toBe(true);
    expect(isSaasCheckoutEventType('checkout.session.async_payment_succeeded')).toBe(true);
    expect(isSaasCheckoutEventType('checkout.session.async_payment_failed')).toBe(true);
    expect(isSaasCheckoutEventType('payment_intent.succeeded')).toBe(false);
    expect(isSaasCheckoutEventType('checkout.session.expired')).toBe(false);
  });

  test('a card payment that is paid continues to the tenant checks', () => {
    expect(precheckSaasEvent(paid())).toEqual({ action: 'continue', tenantSlug: 'chloefood' });
  });

  test('non-SaaS sessions are ignored, whatever their state', () => {
    expect(precheckSaasEvent(paid({ metadataType: undefined }))).toEqual({ action: 'ignore' });
    expect(precheckSaasEvent(paid({ metadataType: 'order', paymentStatus: 'unpaid' }))).toEqual({ action: 'ignore' });
  });

  test('asynchronous payment: completed + unpaid waits, async_payment_succeeded renews, failed alerts', () => {
    expect(precheckSaasEvent(paid({ paymentStatus: 'unpaid' }))).toEqual({ action: 'wait' });
    expect(precheckSaasEvent(paid({ eventType: 'checkout.session.async_payment_succeeded' }))).toEqual({ action: 'continue', tenantSlug: 'chloefood' });
    expect(precheckSaasEvent(paid({ eventType: 'checkout.session.async_payment_failed', paymentStatus: 'unpaid' })))
      .toEqual({ action: 'reject', reason: 'async_payment_failed', alert: true });
    // A "succeeded" event that still says unpaid never renews.
    expect(precheckSaasEvent(paid({ eventType: 'checkout.session.async_payment_succeeded', paymentStatus: 'unpaid' })))
      .toEqual({ action: 'reject', reason: 'not_paid', alert: true });
  });

  test('100 % promotion code / zero amount never renews', () => {
    expect(precheckSaasEvent(paid({ paymentStatus: 'no_payment_required', amountTotal: 0 })))
      .toEqual({ action: 'reject', reason: 'no_payment_required', alert: true });
  });

  test('missing tenant slug and e2e account', () => {
    expect(precheckSaasEvent(paid({ tenantSlug: '  ' }))).toEqual({ action: 'reject', reason: 'missing_tenant_slug', alert: true });
    expect(precheckSaasEvent(paid({ fromE2EAccount: true }))).toEqual({ action: 'reject', reason: 'e2e_account', alert: false });
  });
});

test.describe('SaaS Stripe events: tenant checks', () => {
  test('exact plan price in the plan currency renews (currency case-insensitive)', () => {
    expect(checkSaasPayment(paid(), chloe)).toEqual({ ok: true });
    expect(checkSaasPayment(paid({ amountTotal: 9900 }), chloe)).toEqual({ ok: true });
  });

  test('amount below the plan or other currency renews nothing', () => {
    expect(checkSaasPayment(paid({ amountTotal: 8899 }), chloe)).toEqual({ ok: false, reason: 'amount_too_low' });
    expect(checkSaasPayment(paid({ amountTotal: null }), chloe)).toEqual({ ok: false, reason: 'amount_too_low' });
    expect(checkSaasPayment(paid({ currency: 'usd' }), chloe)).toEqual({ ok: false, reason: 'currency_mismatch' });
  });

  test('test mode only for a test tenant', () => {
    expect(checkSaasPayment(paid({ livemode: false }), chloe)).toEqual({ ok: false, reason: 'test_mode' });
    expect(checkSaasPayment(paid({ livemode: false }), { ...chloe, isTest: true })).toEqual({ ok: true });
  });

  test('a tenant without subscription row is not renewed blindly', () => {
    expect(checkSaasPayment(paid(), { isTest: false, plan: null })).toEqual({ ok: false, reason: 'no_subscription' });
  });

  test('every reason has a French message and the alert escapes values', () => {
    for (const message of Object.values(SAAS_REJECT_MESSAGES)) expect(message.length).toBeGreaterThan(10);
    const email = subscriptionStripeIssueEmail({
      tenantSlug: 'chloe<food>', reason: SAAS_REJECT_MESSAGES.amount_too_low, eventType: 'checkout.session.completed',
      sessionId: 'cs_live_123', amount: '1,00 €', livemode: true, consoleUrl: 'https://shop.test/admin/platform/abonnements',
    });
    expect(email.subject).toContain('Paiement Stripe à vérifier');
    expect(email.html).toContain('chloe&lt;food&gt;');
    expect(email.html).toContain('cs_live_123');
  });
});
