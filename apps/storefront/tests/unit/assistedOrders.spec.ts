import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TenantPaymentMethod } from '@lepefy/types';
import {
  ASSISTED_PAY_LINK_TTL_HOURS, allowedPreorderActions, buildPayLinkMessage, buildWhatsAppShareUrl, computePreorderTotals,
  effectivePreorderStatus, normalizeReceivedAt, parseAssistedAddress, payLinkExpiryFromNow, preorderReference, toCents,
} from '../../src/lib/orders/assisted/assistedOrderPolicy';
import { derivePayLinkToken, hashPayLinkToken, isWellFormedPayLinkToken, newPayLinkNonce } from '../../src/lib/orders/assisted/payLinkToken';
import {
  convertCheckoutSessionToOrder, type ConversionSideEffectDependencies,
} from '../../src/lib/orders/convertCheckoutSessionToOrder';
import {
  currentPayUrl, prepareAssistedCart, resolveAssistedCustomer, revalidateAssistedSession,
} from '../../src/lib/orders/assisted/assistedOrderServer';
import { externalPaymentLink, loadSessionByPayToken, publicExternalMethods } from '../../src/lib/orders/assisted/payLinkPublic';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { runOrderTransitionSideEffects } from '../../src/lib/orders/adminOrderWorkflow';
import { signQuote } from '../../src/lib/shipping/quoteToken';
import type { TenantNotificationContext } from '../../src/lib/notifications/getTenantNotificationContext';

const SECRET = 'test-secret-assisted-orders';
const TENANT = 'tenant-a';
const SESSION = '11111111-2222-4333-8444-555555555555';

test.beforeEach(() => {
  process.env.TRACKING_SECRET = SECRET;
  process.env.N8N_WEBHOOK_URL = 'https://n8n.example.invalid';
});
test.afterEach(() => {
  delete process.env.TRACKING_SECRET;
  delete process.env.N8N_WEBHOOK_URL;
});

// ─── Faux client Supabase (tables en mémoire + RPC scriptée) ──────────────────

type Row = Record<string, unknown>;
interface FakeOptions {
  tables?: Record<string, Row[]>;
  rpc?: (args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}

function fakeSupabase({ tables = {}, rpc }: FakeOptions) {
  const inserts: Array<{ table: string; row: Row }> = [];
  const filtersSeen: Array<{ table: string; column: string; value: unknown }> = [];
  const rpcCalls: Array<Record<string, unknown>> = [];
  const client = {
    rpc(_name: string, args: Record<string, unknown>) {
      rpcCalls.push(args);
      return rpc ? rpc(args) : Promise.resolve({ data: null, error: { message: 'no rpc' } });
    },
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let patch: Row | null = null;
      let limit = Infinity;
      const run = () => {
        const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row))).slice(0, limit);
        if (patch) for (const row of rows) Object.assign(row, patch);
        return rows.map((row) => ({ ...row }));
      };
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { filtersSeen.push({ table, column, value }); filters.push((row) => row[column] === value); return query; },
        in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return query; },
        is(column: string, value: unknown) { filters.push((row) => (row[column] ?? null) === value); return query; },
        gt() { return query; }, lte() { return query; }, order() { return query; }, contains() { return query; },
        limit(value: number) { limit = value; return query; },
        update(value: Row) { patch = value; return query; },
        insert(row: Row) { inserts.push({ table, row }); return Promise.resolve({ error: null }); },
        single() { const rows = run(); return Promise.resolve(rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } }); },
        maybeSingle() { return Promise.resolve({ data: run()[0] ?? null, error: null }); },
        then(resolve: (value: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: run(), error: null }).then(resolve); },
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, inserts, filtersSeen, rpcCalls };
}

function effects() {
  const messages: Array<{ path: string; payload: Record<string, unknown> }> = [];
  const refunds: string[] = [];
  const crm: Array<Record<string, unknown>> = [];
  const nala: string[] = [];
  const deps: ConversionSideEffectDependencies = {
    notifyN8n: async (path, payload) => { messages.push({ path, payload }); return true; },
    getTenantNotificationContext: async () => ({ tenantId: TENANT, tenantName: 'Chloé', storefrontUrl: 'https://shop.example' } as TenantNotificationContext),
    registerCheckoutConsent: async () => undefined,
    recordOrderCustomerEvents: async (input) => { crm.push(input as unknown as Record<string, unknown>); },
    recordNalaPurchaseAttribution: async ({ orderId }) => { nala.push(orderId); },
    refundPaymentIntent: async (id) => { refunds.push(id); return { id: `re_${id}` }; },
  };
  return { deps, messages, refunds, crm, nala };
}

const ORDER_ID = '99999999-8888-4777-8666-555555555555';

function conversionTables(overrides: { email?: string | null; origin?: string; notify?: boolean; status?: string } = {}) {
  return {
    orders: [{
      id: ORDER_ID, tenant_id: TENANT, email: overrides.email === undefined ? 'awa@example.com' : overrides.email,
      full_name: 'Awa Diallo', fulfillment_type: 'pickup', total: 24, shipping_cost: 0, shipping_address: null,
      customer_id: 'cust-1', status: overrides.status ?? 'preparing', stripe_payment_intent_id: 'pi_1',
    }],
    checkout_sessions: [{
      id: SESSION, tenant_id: TENANT, customer_id: 'cust-1', email: overrides.email === undefined ? 'awa@example.com' : overrides.email,
      origin: overrides.origin ?? 'assisted', sales_channel: 'whatsapp', notify_customer: overrides.notify ?? true,
      items: [{ productId: 'p1', name: 'Ndolé', price: 6, quantity: 4 }],
    }],
    assisted_order_events: [] as Row[],
  };
}

const created = { data: { order_id: ORDER_ID, created: true, stock_conflict: false }, error: null };
const replayed = { data: { order_id: ORDER_ID, created: false, stock_conflict: false }, error: null };

// ─── Politique / lifecycle ───────────────────────────────────────────────────

test('preorder statuses map onto the existing checkout lifecycle with explicit admin actions', () => {
  expect(allowedPreorderActions('draft', false)).toEqual(['edit', 'issue_link', 'record_payment', 'cancel']);
  expect(allowedPreorderActions('open', true)).toContain('share_link');
  expect(allowedPreorderActions('open', false)).not.toContain('share_link');
  expect(allowedPreorderActions('awaiting_verification', false)).toEqual(['confirm_payment', 'reopen', 'cancel']);
  expect(allowedPreorderActions('expired', false)).toEqual(['edit', 'issue_link', 'cancel']);
  // Une précommande terminée ne peut plus être payée ni modifiée.
  expect(allowedPreorderActions('completed', true)).toEqual(['open_order']);
  expect(allowedPreorderActions('cancelled', true)).toEqual([]);
});

test('an open link past its expiry is effectively expired; drafts never expire', () => {
  const past = new Date(Date.now() - 1000).toISOString();
  expect(effectivePreorderStatus('open', past)).toBe('expired');
  expect(effectivePreorderStatus('draft', past)).toBe('draft');
  expect(effectivePreorderStatus('awaiting_verification', past)).toBe('awaiting_verification');
  const expiry = new Date(payLinkExpiryFromNow(new Date('2026-09-25T10:00:00Z'))).getTime();
  expect(expiry - new Date('2026-09-25T10:00:00Z').getTime()).toBe(ASSISTED_PAY_LINK_TTL_HOURS * 3_600_000);
});

test('totals use the same cent rounding as the SQL conversion and the PaymentIntent', () => {
  const totals = computePreorderTotals([{ price: 2.99, quantity: 3 }, { price: 0.1, quantity: 3 }], 7.9, 1);
  expect(totals).toEqual({ subtotal: 9.27, shippingTotal: 7.9, discount: 1, total: 16.17 });
  expect(toCents(totals.total)).toBe(1617);
});

test('reference, WhatsApp share and messages never invent a country code', () => {
  expect(preorderReference(SESSION)).toBe('P-11111111');
  expect(buildWhatsAppShareUrl('+39 345 123 4567', 'Bonjour')).toBe('https://wa.me/393451234567?text=Bonjour');
  expect(buildWhatsAppShareUrl('0039 345 1234567', 'x')).toBe('https://wa.me/393451234567?text=x');
  expect(buildWhatsAppShareUrl('345 1234567', 'x')).toBe('https://wa.me/?text=x');
  expect(buildWhatsAppShareUrl(null, 'a b')).toBe('https://wa.me/?text=a%20b');
  const message = buildPayLinkMessage({ customerName: 'Awa Diallo', reference: 'P-1', totalLabel: '24,00 €', url: 'https://x/pay/t', tenantName: 'Chloé' });
  expect(message).toContain('Bonjour Awa,');
  expect(message).toContain('https://x/pay/t');
});

test('operator input is strictly validated (address, receipt date)', () => {
  expect(parseAssistedAddress({ full_name: 'A', line1: 'Via Roma 1', city: 'Reggio', postal_code: '42121', country: 'it' }))
    .toEqual({ full_name: 'A', line1: 'Via Roma 1', line2: null, city: 'Reggio', postal_code: '42121', country: 'IT' });
  expect(parseAssistedAddress({ full_name: 'A', line1: 'x', city: 'y', postal_code: '1', country: 'ITA' })).toBeNull();
  expect(parseAssistedAddress(null)).toBeNull();
  const now = Date.parse('2026-09-25T12:00:00Z');
  expect(normalizeReceivedAt(undefined, now)).toBe('2026-09-25T12:00:00.000Z');
  expect(normalizeReceivedAt('2026-09-24T08:00:00Z', now)).toBe('2026-09-24T08:00:00.000Z');
  expect(normalizeReceivedAt('2026-09-26T08:00:00Z', now)).toBeNull();
  expect(normalizeReceivedAt('pas une date', now)).toBeNull();
});

// ─── Jeton de lien : opaque, révocable, réémis ───────────────────────────────

test('pay-link token is opaque, deterministic per nonce and revoked by a new nonce', () => {
  const nonce = newPayLinkNonce();
  const token = derivePayLinkToken(SESSION, nonce, SECRET)!;
  expect(isWellFormedPayLinkToken(token)).toBe(true);
  expect(token).not.toContain(SESSION.slice(0, 8));
  expect(derivePayLinkToken(SESSION, nonce, SECRET)).toBe(token);
  const reissued = derivePayLinkToken(SESSION, newPayLinkNonce(), SECRET)!;
  expect(reissued).not.toBe(token);
  expect(hashPayLinkToken(reissued)).not.toBe(hashPayLinkToken(token));
  expect(derivePayLinkToken(SESSION, nonce, '')).toBeNull();
  expect(isWellFormedPayLinkToken('../../etc')).toBe(false);
});

test('current pay URL is shown only for the live link of a payable session', () => {
  const nonce = newPayLinkNonce();
  const token = derivePayLinkToken(SESSION, nonce)!;
  const base = { id: SESSION, pay_token_nonce: nonce, pay_token_hash: hashPayLinkToken(token) };
  const tenant = { storefront_url: 'https://shop.example' };
  expect(currentPayUrl(tenant, { ...base, status: 'open' })).toBe(`https://shop.example/pay/${token}`);
  expect(currentPayUrl(tenant, { ...base, status: 'completed' })).toBeNull();
  // Modification après partage : hash révoqué → plus aucun lien affiché.
  expect(currentPayUrl(tenant, { ...base, pay_token_hash: null, status: 'draft' })).toBeNull();
  expect(currentPayUrl(tenant, { ...base, pay_token_hash: 'deadbeef', status: 'open' })).toBeNull();
});

test('public link lookup is tenant-scoped and never queries for a malformed token', async () => {
  const token = derivePayLinkToken(SESSION, newPayLinkNonce())!;
  const other = fakeSupabase({ tables: { checkout_sessions: [{ id: SESSION, tenant_id: 'tenant-b', origin: 'assisted', pay_token_hash: hashPayLinkToken(token), status: 'open' }] } });
  expect(await loadSessionByPayToken(other.client as never, TENANT, token)).toBeNull();
  expect(other.filtersSeen).toContainEqual({ table: 'checkout_sessions', column: 'tenant_id', value: TENANT });
  const malformed = fakeSupabase({});
  expect(await loadSessionByPayToken(malformed.client as never, TENANT, 'abc')).toBeNull();
  expect(malformed.filtersSeen).toHaveLength(0);
});

// ─── Moyens de paiement publics ──────────────────────────────────────────────

test('pay page offers only active shop methods usable remotely', () => {
  const method = (overrides: Partial<TenantPaymentMethod>): TenantPaymentMethod => ({
    id: overrides.method ?? 'x', tenant_id: TENANT, method: 'other', label: null, value: null, extra: null,
    sort_order: 0, active: true, enabled_modules: ['shop'], ...overrides,
  });
  const methods = publicExternalMethods([
    method({ id: 'iban', method: 'bank_transfer', value: 'IT60X0542811101000000123456', extra: { beneficiary: 'Chloé', bic: 'BPMOIT22' } }),
    method({ id: 'pp', method: 'paypal', extra: { link: 'https://paypal.me/chloe' } }),
    method({ id: 'rev', method: 'other', label: 'Revolut', extra: { link: 'https://revolut.me/chloe' } }),
    method({ id: 'cash', method: 'cash' }),
    method({ id: 'card', method: 'card' }),
    method({ id: 'events-only', method: 'paypal', enabled_modules: ['event'], extra: { link: 'https://paypal.me/e' } }),
    method({ id: 'off', method: 'satispay', active: false, value: 'x' }),
    method({ id: 'iban-empty', method: 'bank_transfer' }),
  ]);
  expect(methods.map((m) => [m.id, m.kind, m.label])).toEqual([
    ['iban', 'transfer', 'Virement bancaire'], ['pp', 'link', 'PayPal'], ['rev', 'link', 'Revolut'],
  ]);
  expect(externalPaymentLink(method({ method: 'paypal', extra: { link: 'https://paypal.me/chloe/' } }), 24.5, 'eur'))
    .toBe('https://paypal.me/chloe/24.50EUR');
  expect(externalPaymentLink(method({ extra: { link: 'https://revolut.me/c' } }), 24.5, 'EUR')).toBe('https://revolut.me/c');
});

// ─── Conversion centrale : idempotence, notifications, CRM, stock ────────────

test('Stripe-paid WhatsApp preorder converts once and emits one confirmation', async () => {
  const tables = conversionTables();
  const fake = fakeSupabase({ tables, rpc: async () => created });
  const fx = effects();
  const result = await convertCheckoutSessionToOrder(fake.client, {
    tenantId: TENANT, sessionId: SESSION, payment: { source: 'stripe_webhook', paymentIntentId: 'pi_1' },
  }, fx.deps);
  expect(result.ok && result.created).toBe(true);
  expect(fake.rpcCalls[0]).toMatchObject({ p_tenant_id: TENANT, p_session_id: SESSION,
    p_payment: { source: 'stripe_webhook', payment_method: 'stripe', stripe_payment_intent_id: 'pi_1' } });
  expect(fx.messages.map((m) => m.path)).toEqual(['/webhook/order-confirmed']);
  expect(fx.messages[0]!.payload.orderTrackingLink).toMatch(/^https:\/\/shop\.example\/orders\/9999/);
  // Nala n'est jamais crédité d'une vente assistée ; le CRM connaît l'origine.
  expect(fx.nala).toEqual([]);
  expect(fx.crm[0]).toMatchObject({ source: 'assisted_order', orderMetadata: { order_origin: 'assisted', sales_channel: 'whatsapp' } });
  const eventTypes = fake.inserts.filter((i) => i.table === 'assisted_order_events').map((i) => i.row.event_type);
  expect(eventTypes).toEqual(['payment_confirmed', 'order_created', 'notification_sent']);
});

test('duplicate Stripe webhook: no second order, no side effect', async () => {
  const fake = fakeSupabase({ tables: conversionTables(), rpc: async () => replayed });
  const fx = effects();
  const result = await convertCheckoutSessionToOrder(fake.client, {
    tenantId: TENANT, sessionId: SESSION, payment: { source: 'stripe_webhook', paymentIntentId: 'pi_1' },
  }, fx.deps);
  expect(result.ok && !result.created && result.customerNotification).toBe('not_applicable');
  expect(fx.messages).toEqual([]);
  expect(fx.crm).toEqual([]);
  expect(fake.inserts).toEqual([]);
});

test('two simultaneous admin confirmations create a single order and a single notification', async () => {
  // Le verrou FOR UPDATE de la RPC sérialise : le premier appel crée, le second relit.
  let calls = 0;
  const fake = fakeSupabase({ tables: conversionTables(), rpc: async () => (++calls === 1 ? created : replayed) });
  const fx = effects();
  const payment = { source: 'admin_verified' as const, method: 'external_link' as const, externalPaymentType: 'bank_transfer', confirmedBy: 'admin-1' };
  const [first, second] = await Promise.all([
    convertCheckoutSessionToOrder(fake.client, { tenantId: TENANT, sessionId: SESSION, payment }, fx.deps),
    convertCheckoutSessionToOrder(fake.client, { tenantId: TENANT, sessionId: SESSION, payment }, fx.deps),
  ]);
  const createdCount = [first, second].filter((r) => r.ok && r.created).length;
  expect(createdCount).toBe(1);
  expect(fx.messages.filter((m) => m.path === '/webhook/order-confirmed')).toHaveLength(1);
  expect(fx.crm).toHaveLength(1);
});

test('declared bank transfer verified by an admin is traced as admin_verified', async () => {
  const fake = fakeSupabase({ tables: conversionTables(), rpc: async () => created });
  const fx = effects();
  await convertCheckoutSessionToOrder(fake.client, {
    tenantId: TENANT, sessionId: SESSION,
    payment: { source: 'admin_verified', method: 'external_link', externalPaymentType: 'bank_transfer', externalPaymentLabel: 'Virement bancaire', reference: 'VIR-42', confirmedBy: 'admin-1', receivedAt: '2026-09-24T08:00:00.000Z' },
  }, fx.deps);
  expect(fake.rpcCalls[0]!.p_payment).toMatchObject({
    source: 'admin_verified', payment_method: 'external_link', external_payment_type: 'bank_transfer',
    reference: 'VIR-42', confirmed_by: 'admin-1', received_at: '2026-09-24T08:00:00.000Z',
  });
  const confirmed = fake.inserts.find((i) => i.row.event_type === 'payment_confirmed');
  expect(confirmed?.row).toMatchObject({ actor_type: 'admin', actor_admin_id: 'admin-1' });
});

for (const [method, label] of [['cash', 'Espèces'], ['postepay', 'Postepay']] as const) {
  test(`already-paid order (${method}) is recorded manually, distinct from Stripe`, async () => {
    const fake = fakeSupabase({ tables: conversionTables({ notify: false }), rpc: async () => created });
    const fx = effects();
    const result = await convertCheckoutSessionToOrder(fake.client, {
      tenantId: TENANT, sessionId: SESSION,
      payment: { source: 'admin_recorded', method: 'manual', externalPaymentType: method, externalPaymentLabel: label, confirmedBy: 'admin-1' },
    }, fx.deps);
    expect(fake.rpcCalls[0]!.p_payment).toMatchObject({ source: 'admin_recorded', payment_method: 'manual', external_payment_type: method });
    // Le tenant a choisi de ne pas envoyer le récapitulatif.
    expect(result.ok && result.customerNotification).toBe('skipped_by_choice');
    expect(fx.messages).toEqual([]);
  });
}

test('customer with phone but no email: no email claimed, tracking link available to share', async () => {
  const fake = fakeSupabase({ tables: conversionTables({ email: null }), rpc: async () => created });
  const fx = effects();
  const result = await convertCheckoutSessionToOrder(fake.client, {
    tenantId: TENANT, sessionId: SESSION, payment: { source: 'admin_recorded', method: 'manual', externalPaymentType: 'cash' },
    notifyCustomer: true,
  }, fx.deps);
  expect(result.ok && result.customerNotification).toBe('skipped_no_email');
  expect(result.ok && result.trackingLink).toMatch(/\/orders\/9999.*\?token=[0-9a-f]{64}$/);
  expect(fx.messages).toEqual([]);
});

test('stock exhausted at conversion: Stripe refund, admin alert, no customer confirmation', async () => {
  const tables = conversionTables({ status: 'stock_conflict' });
  const fake = fakeSupabase({ tables, rpc: async () => ({ data: { order_id: ORDER_ID, created: true, stock_conflict: true, stock_error: 'insufficient_stock:p1' }, error: null }) });
  const fx = effects();
  const result = await convertCheckoutSessionToOrder(fake.client, {
    tenantId: TENANT, sessionId: SESSION, payment: { source: 'stripe_webhook', paymentIntentId: 'pi_1' },
  }, fx.deps);
  expect(result.ok && result.stockConflict && result.refundSucceeded).toBe(true);
  expect(fx.refunds).toEqual(['pi_1']);
  expect(fx.messages.map((m) => m.path)).toEqual(['/webhook/order-stock-conflict']);
  expect(fx.crm).toEqual([]);
});

test('storefront external confirmation keeps its historical CRM source and Nala attribution', async () => {
  const fake = fakeSupabase({ tables: conversionTables({ origin: 'storefront' }), rpc: async () => created });
  const fx = effects();
  await convertCheckoutSessionToOrder(fake.client, {
    tenantId: TENANT, sessionId: SESSION, payment: { source: 'admin_verified', method: 'external_link' },
  }, fx.deps);
  expect(fx.crm[0]).toMatchObject({ source: 'external_payment_confirmation' });
  expect(fx.nala).toEqual([ORDER_ID]);
  expect(fake.inserts.filter((i) => i.table === 'assisted_order_events')).toEqual([]);
});

test('conversion refusals are mapped (cancelled session, missing migration)', async () => {
  const fx = effects();
  const cancelled = fakeSupabase({ rpc: async () => ({ data: null, error: { code: 'P0001', message: 'session_not_convertible:cancelled' } }) });
  expect(await convertCheckoutSessionToOrder(cancelled.client, { tenantId: TENANT, sessionId: SESSION, payment: { source: 'admin_verified', method: 'external_link' } }, fx.deps))
    .toEqual({ ok: false, reason: 'session_not_convertible', sessionStatus: 'cancelled' });
  const missing = fakeSupabase({ rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) });
  expect(await convertCheckoutSessionToOrder(missing.client, { tenantId: TENANT, sessionId: SESSION, payment: { source: 'stripe_webhook', paymentIntentId: 'pi' } }, fx.deps))
    .toEqual({ ok: false, reason: 'rpc_unavailable' });
  expect(fx.messages).toEqual([]);
});

// ─── Panier : règles de quantité, stock, livraison ───────────────────────────

const tenantRow = {
  id: TENANT, shipping_pricing_mode: 'provider_cost', shipping_tariff_fallback: 'unavailable', click_collect_enabled: true,
  ambassador_min_purchase_amount: null, ambassador_commission_mode: null, ambassador_split_pool_amount: null,
  ambassador_split_pool_ambassador_percent: null, ambassador_first_order_discount_type: null, ambassador_first_order_discount_value: null,
} as never;

function catalog(stock = 24, groups: Row[] = []) {
  return fakeSupabase({
    tables: {
      products: [
        { id: 'ndole', tenant_id: TENANT, active: true, name: 'Ndolé', price: 6, storage_type: 'frozen', stock: 16, min_order_quantity: 4, order_quantity_step: 4 },
        { id: 'coca', tenant_id: TENANT, active: true, name: 'Coca', price: 1.5, storage_type: 'dry', stock, min_order_quantity: 1, order_quantity_step: 1 },
      ],
      purchase_quantity_groups: groups,
    },
  });
}
const boissons = { id: 'g1', tenant_id: TENANT, active: true, name: 'Boissons', min_quantity: 12, quantity_step: 6, purchase_quantity_group_products: [{ product_id: 'coca' }] };

test('assisted cart re-applies product minimum/step and combinable group rules server-side', async () => {
  const base = { fulfillmentType: 'pickup', shippingAddress: null, quoteToken: null, shippingDetails: null, customerId: null, allowPendingShipping: false };
  const belowMinimum = await prepareAssistedCart(catalog().client as never, tenantRow, { ...base, items: [{ productId: 'ndole', quantity: 2 }] });
  expect(belowMinimum.ok === false && belowMinimum.body.code).toBe('QUANTITY_RULE_VIOLATION');
  const groupShort = await prepareAssistedCart(catalog(24, [boissons]).client as never, tenantRow, { ...base, items: [{ productId: 'coca', quantity: 6 }] });
  expect(groupShort.ok === false && groupShort.body.code).toBe('QUANTITY_RULE_VIOLATION');
  const valid = await prepareAssistedCart(catalog(24, [boissons]).client as never, tenantRow, {
    ...base, items: [{ productId: 'ndole', quantity: 4, price: 0.01 }, { productId: 'coca', quantity: 12 }],
  });
  expect(valid.ok).toBe(true);
  // Le prix du navigateur est ignoré : prix catalogue uniquement.
  if (valid.ok) expect(valid.cart).toMatchObject({ subtotal: 42, shippingTotal: 0, total: 42, fulfillmentType: 'pickup' });
});

test('national and international delivery use the tenant signed quote, never a hard-coded rate', async () => {
  const base = { fulfillmentType: 'delivery', shippingDetails: null, customerId: null, allowPendingShipping: false, items: [{ productId: 'ndole', quantity: 4 }] };
  const italy = { full_name: 'Awa', line1: 'Via Roma 1', city: 'Reggio Emilia', postal_code: '42121', country: 'IT' };
  const france = { full_name: 'Awa', line1: 'Rue de Paris 1', city: 'Lyon', postal_code: '69001', country: 'FR' };
  const national = await prepareAssistedCart(catalog().client as never, tenantRow, { ...base, shippingAddress: italy, quoteToken: signQuote(9.9, 'IT', '42121', SECRET) });
  expect(national.ok && national.cart.total).toBe(33.9);
  const international = await prepareAssistedCart(catalog().client as never, tenantRow, { ...base, shippingAddress: france, quoteToken: signQuote(21.5, 'FR', '69001', SECRET) });
  expect(international.ok && international.cart.shippingTotal).toBe(21.5);
  // Devis d'une autre adresse : refusé.
  const mismatch = await prepareAssistedCart(catalog().client as never, tenantRow, { ...base, shippingAddress: france, quoteToken: signQuote(9.9, 'IT', '42121', SECRET) });
  expect(mismatch.ok).toBe(false);
  // Sans devis : seul un brouillon est accepté, marqué « à calculer ».
  const missing = await prepareAssistedCart(catalog().client as never, tenantRow, { ...base, shippingAddress: italy, quoteToken: null });
  expect(missing.ok === false && missing.body.code).toBe('SHIPPING_QUOTE_REQUIRED');
  const draft = await prepareAssistedCart(catalog().client as never, tenantRow, { ...base, shippingAddress: italy, quoteToken: null, allowPendingShipping: true });
  expect(draft.ok && draft.cart.shippingPending).toBe(true);
});

test('product sold out before payment blocks the payment, prices stay those of the link', async () => {
  const session = {
    items: [{ productId: 'coca', name: 'Coca', price: 1.2, quantity: 12, storage_type: 'dry' as const }],
    fulfillment_type: 'pickup' as const, shipping_address: null, shipping_details: null, shipping_total: 0,
  };
  expect((await revalidateAssistedSession(catalog(24).client as never, tenantRow, session)).ok).toBe(true);
  const soldOut = await revalidateAssistedSession(catalog(5).client as never, tenantRow, session);
  expect(soldOut.ok === false && [soldOut.status, soldOut.body.code]).toEqual([409, 'INSUFFICIENT_STOCK']);
  const pendingShipping = await revalidateAssistedSession(catalog().client as never, tenantRow, { ...session, shipping_details: { quotePending: true } });
  expect(pendingShipping.ok === false && pendingShipping.body.code).toBe('SHIPPING_QUOTE_REQUIRED');
});

// ─── Identité client / CRM ───────────────────────────────────────────────────

test('customer identity: existing CRM contact reused, other tenant refused, contact required', async () => {
  const crm = fakeSupabase({ tables: { customers: [{ id: '22222222-3333-4444-8555-666666666666', tenant_id: TENANT, full_name: 'Awa', email: 'AWA@Example.com', phone: null }] } });
  const reused = await resolveAssistedCustomer(crm.client as never, TENANT, { id: '22222222-3333-4444-8555-666666666666', phone: '+39 345 1234567' });
  expect(reused.ok && reused.customer).toEqual({ customerId: '22222222-3333-4444-8555-666666666666', fullName: 'Awa', email: 'awa@example.com', phone: '+39 345 1234567' });
  const foreign = await resolveAssistedCustomer(crm.client as never, 'tenant-b', { id: '22222222-3333-4444-8555-666666666666' });
  expect(foreign.ok === false && foreign.status).toBe(404);
  expect((await resolveAssistedCustomer(crm.client as never, TENANT, { fullName: 'Sans contact' })).ok).toBe(false);
  expect((await resolveAssistedCustomer(crm.client as never, TENANT, { fullName: 'A', email: 'pas-un-email' })).ok).toBe(false);
});

// ─── Autorisations admin ─────────────────────────────────────────────────────

test('assisted-order admin APIs are mapped to explicit capabilities (fail-closed otherwise)', () => {
  expect(permissionForAdminApi('/api/admin/assisted-orders', 'GET')).toBe('orders.view');
  expect(permissionForAdminApi('/api/admin/assisted-orders', 'POST')).toBe('orders.manage');
  expect(permissionForAdminApi(`/api/admin/assisted-orders/${SESSION}`, 'PATCH')).toBe('orders.manage');
  expect(permissionForAdminApi(`/api/admin/assisted-orders/${SESSION}/link`, 'POST')).toBe('orders.manage');
  expect(permissionForAdminApi(`/api/admin/assisted-orders/${SESSION}/cancel`, 'POST')).toBe('orders.manage');
  // Créer une commande payée = capability critique de confirmation d'encaissement.
  expect(permissionForAdminApi('/api/admin/assisted-orders/paid', 'POST')).toBe('shop_payments.confirm');
  expect(permissionForAdminApi(`/api/admin/assisted-orders/${SESSION}/confirm-payment`, 'POST')).toBe('shop_payments.confirm');
  expect(permissionForAdminApi(`/api/admin/assisted-orders/${SESSION}/confirm-payment`, 'GET')).toBeNull();
  expect(permissionForAdminApi('/api/admin/assisted-orders/customers', 'GET')).toBe('orders.manage');
  expect(permissionForAdminApi('/api/admin/assisted-orders/products', 'GET')).toBe('orders.manage');
});

// ─── Workflow logistique après conversion ────────────────────────────────────

test('logistics workflow: an order without email still ships, loyalty runs, no email webhook', async () => {
  const hooks: string[] = [];
  const messages: string[] = [];
  const deps = {
    processOrderPointsOnDelivery: async (id: string) => { hooks.push(id); },
    notifyN8n: async (path: string) => { messages.push(path); return true; },
    getTenantNotificationContext: async () => ({ tenantId: TENANT, storefrontUrl: 'https://shop.example' } as TenantNotificationContext),
  };
  await runOrderTransitionSideEffects({ tenantId: TENANT, orderId: ORDER_ID, previousStatus: 'preparing', nextStatus: 'shipped', email: null, fullName: 'Awa', fulfillmentType: 'delivery', trackingCode: 'BRT1' }, deps);
  await runOrderTransitionSideEffects({ tenantId: TENANT, orderId: ORDER_ID, previousStatus: 'shipped', nextStatus: 'delivered', email: null, fullName: 'Awa', fulfillmentType: 'delivery' }, deps);
  expect(messages).toEqual([]);
  expect(hooks).toEqual([ORDER_ID]);
  await runOrderTransitionSideEffects({ tenantId: TENANT, orderId: ORDER_ID, previousStatus: 'preparing', nextStatus: 'shipped', email: 'awa@example.com', fullName: 'Awa', fulfillmentType: 'delivery', trackingCode: 'BRT1' }, deps);
  expect(messages).toEqual(['/webhook/order-shipped']);
});

