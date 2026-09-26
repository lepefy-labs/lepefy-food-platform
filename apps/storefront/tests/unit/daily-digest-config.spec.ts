import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DAILY_DIGEST_DEFAULTS, dailyDigestModule, dailyDigestPatchSchema, isValidIanaTimeZone, toDigestThresholds,
} from '../../src/lib/notifications/dailyDigestConfig';
import { mergeModuleConfig, resolveModuleConfig, updateModuleConfig, ModuleConfigValidationError } from '../../src/lib/tenantConfig/moduleConfig';
import { deliverTenantDigest, listDigestTenants, type DigestRunnerDeps } from '../../src/lib/notifications/dailyDigestRunner';
import { tenantClock } from '../../src/lib/notifications/dailyOrderDigest';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import type { TenantNotificationContext } from '../../src/lib/notifications/getTenantNotificationContext';

// ─── Minimal chainable Supabase double: records every call, resolves per table ──
type Op = [string, unknown[]];
interface Call { table: string; ops: Op[] }
type Result = { data: unknown; error: unknown };

function fakeDb(results: Record<string, (call: Call) => Result> = {}, claim: boolean = true) {
  const calls: Call[] = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const builder: unknown = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') {
          const result = results[table]?.(call) ?? { data: null, error: null };
          return (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => { call.ops.push([String(prop), args]); return builder; };
      },
    });
    return builder;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return { data: claim, error: null };
  };
  return { db: { from, rpc } as unknown as SupabaseClient, calls, rpcCalls };
}

const hasOp = (call: Call, name: string, ...args: unknown[]) =>
  call.ops.some(([op, opArgs]) => op === name && JSON.stringify(opArgs.slice(0, args.length)) === JSON.stringify(args));

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const EIGHT_AM_ROME = new Date('2026-09-26T06:00:00Z');

function branding(tenantId: string): TenantNotificationContext {
  return {
    tenantId, tenantSlug: 'tenant', tenantName: 'Tenant', storefrontUrl: 'https://shop.example.com/',
    locale: 'fr-FR', currency: 'EUR',
    branding: { logoUrl: null, primaryColor: '#000', secondaryColor: '#000', accentColor: '#000' },
  } as unknown as TenantNotificationContext;
}

function deps(db: SupabaseClient, overrides: Partial<DigestRunnerDeps> = {}) {
  const notified: Array<Record<string, unknown>> = [];
  const recipientLookups: string[] = [];
  const value: DigestRunnerDeps = {
    db,
    getRecipients: async (tenantId) => { recipientLookups.push(tenantId); return ['ops@example.com']; },
    getBranding: async (tenantId) => branding(tenantId),
    notify: async (_path, payload) => { notified.push(payload); return true; },
    ...overrides,
  };
  return { value, notified, recipientLookups };
}

const paidOrder = {
  id: 'aaaaaaaa-order', full_name: 'Marie', email: null, payment_status: 'paid', status: 'new',
  fulfillment_type: 'delivery', created_at: '2026-09-26T05:00:00Z', updated_at: '2026-09-26T05:00:00Z',
  shipping_normalized_status: null, shipping_sync_error: null, shipping_provider_reference: null,
  shipping_estimated_delivery_at: null, shipping_provider_synced_at: null, shipping_tracking_events: null,
};

// ─── Configuration resolution ──────────────────────────────────────────────────
test('missing settings row keeps the digest disabled with defaults', () => {
  const state = resolveModuleConfig(dailyDigestModule, null);
  expect(state).toEqual({ status: 'missing', enabled: false, active: false, config: DAILY_DIGEST_DEFAULTS });
});

test('stored enabled=false row is never active', () => {
  const state = resolveModuleConfig(dailyDigestModule, { enabled: false, config: { timezone: 'Europe/Paris' } });
  expect(state.status).toBe('ok');
  expect(state.active).toBe(false);
});

test('valid enabled configuration is active and typed', () => {
  const state = resolveModuleConfig(dailyDigestModule, {
    enabled: true,
    config: { version: 1, timezone: 'America/New_York', include_empty: true, prepare_hours: 12, pickup_hours: 24, payment_verification_hours: 36, tracking_stale_hours: 96 },
  });
  expect(state.status).toBe('ok');
  expect(state.active).toBe(true);
  expect(toDigestThresholds(state.config)).toEqual({ prepareHours: 12, pickupHours: 24, paymentVerificationHours: 36, trackingStaleHours: 96 });
});

test('partial configuration falls back to centralized defaults per key', () => {
  const state = resolveModuleConfig(dailyDigestModule, { enabled: true, config: { pickup_hours: 72 } });
  expect(state.status).toBe('ok');
  expect(state.config).toEqual({ ...DAILY_DIGEST_DEFAULTS, pickup_hours: 72 });
});

test('invalid stored configuration fails closed instead of using silent defaults', () => {
  for (const config of [
    { timezone: 'Mars/Olympus' },
    { timezone: '+01:00' },
    { prepare_hours: 0 },
    { tracking_stale_hours: 12 },
    { pickup_hours: 400 },
    { payment_verification_hours: 1.5 },
    { include_empty: 'yes' },
    { version: 2 },
    ['not', 'an', 'object'],
  ]) {
    const state = resolveModuleConfig(dailyDigestModule, { enabled: true, config });
    expect(state.status, JSON.stringify(config)).toBe('invalid');
    expect(state.active).toBe(false);
  }
});

test('IANA validation accepts named zones only', () => {
  for (const zone of ['Europe/Rome', 'America/Argentina/Buenos_Aires', 'America/Port-au-Prince', 'Etc/GMT+1', 'UTC']) {
    expect(isValidIanaTimeZone(zone), zone).toBe(true);
  }
  for (const zone of ['', 'Rome', '+01:00', 'Europe/Nowhere', 'Europe/Rome; drop table']) {
    expect(isValidIanaTimeZone(zone), zone).toBe(false);
  }
});

// ─── Partial updates ──────────────────────────────────────────────────────────
test('partial update keeps stored values and activation when omitted', () => {
  const next = mergeModuleConfig(dailyDigestModule, { enabled: true, config: { ...DAILY_DIGEST_DEFAULTS, timezone: 'Europe/Paris' } }, { config: { prepare_hours: 12 } });
  expect(next).toEqual({ enabled: true, config: { ...DAILY_DIGEST_DEFAULTS, timezone: 'Europe/Paris', prepare_hours: 12 } });
});

test('first save without explicit activation stays disabled', () => {
  expect(mergeModuleConfig(dailyDigestModule, null, { config: { include_empty: true } }).enabled).toBe(false);
});

test('update rejecting invalid thresholds never writes', async () => {
  const { db, calls } = fakeDb();
  await expect(updateModuleConfig(db, dailyDigestModule, TENANT_A, { config: { pickup_hours: 0 } }))
    .rejects.toBeInstanceOf(ModuleConfigValidationError);
  expect(calls.some((call) => call.ops.some(([op]) => op === 'upsert'))).toBe(false);
});

test('update touches only the daily digest row of the current tenant (Nala untouched)', async () => {
  const { db, calls } = fakeDb({
    tenant_feature_settings: (call) => call.ops.some(([op]) => op === 'upsert')
      ? { data: null, error: null }
      : { data: { enabled: false, config: {} }, error: null },
  });
  await updateModuleConfig(db, dailyDigestModule, TENANT_A, { enabled: true, config: { timezone: 'Europe/Paris' } });
  const read = calls[0]!;
  expect(hasOp(read, 'eq', 'tenant_id', TENANT_A)).toBe(true);
  expect(hasOp(read, 'eq', 'feature_key', 'daily_order_digest')).toBe(true);
  const upsert = calls[1]!.ops.find(([op]) => op === 'upsert')!;
  const row = upsert[1][0] as Record<string, unknown>;
  expect(row.tenant_id).toBe(TENANT_A);
  expect(row.feature_key).toBe('daily_order_digest');
  expect(row.enabled).toBe(true);
  expect(upsert[1][1]).toEqual({ onConflict: 'tenant_id,feature_key' });
  expect(calls.every((call) => call.table === 'tenant_feature_settings')).toBe(true);
});

test('admin PATCH schema rejects unknown fields, version overrides and bad types', () => {
  expect(dailyDigestPatchSchema.safeParse({ enabled: true, config: { timezone: 'Europe/Rome' } }).success).toBe(true);
  expect(dailyDigestPatchSchema.safeParse({ enabled: 'true' }).success).toBe(false);
  expect(dailyDigestPatchSchema.safeParse({ config: { version: 2 } }).success).toBe(false);
  expect(dailyDigestPatchSchema.safeParse({ config: { recipients: ['a@b.c'] } }).success).toBe(false);
  expect(dailyDigestPatchSchema.safeParse({ tenant_id: TENANT_B }).success).toBe(false);
  expect(dailyDigestPatchSchema.safeParse({ config: { prepare_hours: null } }).success).toBe(false);
});

test('admin settings API keeps the existing tenant settings permission', () => {
  expect(permissionForAdminApi('/api/admin/daily-digest', 'GET')).toBe('tenant_settings.view');
  expect(permissionForAdminApi('/api/admin/daily-digest', 'PATCH')).toBe('tenant_settings.manage');
});

// ─── Time zones and DST ───────────────────────────────────────────────────────
test('08:00 local tracks DST transitions in Rome and New York', () => {
  expect(tenantClock(new Date('2026-03-28T07:00:00Z'), 'Europe/Rome')).toEqual({ localDate: '2026-03-28', hour: 8 });
  expect(tenantClock(new Date('2026-03-29T06:00:00Z'), 'Europe/Rome')).toEqual({ localDate: '2026-03-29', hour: 8 });
  expect(tenantClock(new Date('2026-10-25T07:00:00Z'), 'Europe/Rome')).toEqual({ localDate: '2026-10-25', hour: 8 });
  expect(tenantClock(new Date('2026-03-07T13:00:00Z'), 'America/New_York').hour).toBe(8);
  expect(tenantClock(new Date('2026-03-08T12:00:00Z'), 'America/New_York').hour).toBe(8);
});

test('an hourly scheduler hits 08:00 exactly once per local day, even on DST days', () => {
  for (const [zone, day] of [['Europe/Rome', '2026-03-29'], ['Europe/Rome', '2026-10-25'], ['America/New_York', '2026-11-01']] as const) {
    const start = Date.parse(day + 'T00:00:00Z') - 12 * 3600000;
    const hits = Array.from({ length: 48 }, (_, i) => tenantClock(new Date(start + i * 3600000), zone))
      .filter((clock) => clock.localDate === day && clock.hour === 8);
    expect(hits, zone + ' ' + day).toHaveLength(1);
  }
});

// ─── Tenant selection ─────────────────────────────────────────────────────────
test('only enabled rows of active tenants are selected; invalid ones are reported', async () => {
  const { db, calls } = fakeDb({
    tenant_feature_settings: () => ({ data: [
      { tenant_id: TENANT_A, enabled: true, config: { timezone: 'Europe/Rome' } },
      { tenant_id: TENANT_B, enabled: true, config: { timezone: 'Nowhere/Zone' } },
    ], error: null }),
  });
  const selection = await listDigestTenants(db);
  expect(selection.tenants).toEqual([{ tenantId: TENANT_A, config: { ...DAILY_DIGEST_DEFAULTS, timezone: 'Europe/Rome' } }]);
  expect(selection.invalid).toEqual([TENANT_B]);
  const query = calls[0]!;
  expect(hasOp(query, 'eq', 'feature_key', 'daily_order_digest')).toBe(true);
  expect(hasOp(query, 'eq', 'enabled', true)).toBe(true);
  expect(hasOp(query, 'eq', 'tenants.active', true)).toBe(true);
});

// ─── Delivery ─────────────────────────────────────────────────────────────────
const tenantA = { tenantId: TENANT_A, config: DAILY_DIGEST_DEFAULTS };

test('no opted-in recipient: nothing is claimed or sent', async () => {
  const { db, calls, rpcCalls } = fakeDb();
  const d = deps(db, { getRecipients: async () => [] });
  expect(await deliverTenantDigest(d.value, tenantA, EIGHT_AM_ROME)).toBe('no_recipients');
  expect(d.notified).toHaveLength(0);
  expect(rpcCalls).toHaveLength(0);
  expect(calls).toHaveLength(0);
});

test('outside 08:00 local nothing is read or sent', async () => {
  const { db, rpcCalls } = fakeDb();
  const d = deps(db);
  expect(await deliverTenantDigest(d.value, tenantA, new Date('2026-09-26T07:00:00Z'))).toBe('not_due');
  expect(d.recipientLookups).toHaveLength(0);
  expect(rpcCalls).toHaveLength(0);
});

test('lost claim (already processed today) never sends twice', async () => {
  const { db, calls } = fakeDb({}, false);
  const d = deps(db);
  expect(await deliverTenantDigest(d.value, tenantA, EIGHT_AM_ROME)).toBe('already_claimed');
  expect(d.notified).toHaveLength(0);
  expect(calls).toHaveLength(0);
});

test('active tenant with valid config sends one idempotent, tenant-scoped digest', async () => {
  const { db, calls, rpcCalls } = fakeDb({
    orders: () => ({ data: [paidOrder], error: null }),
    checkout_sessions: () => ({ data: [], error: null }),
  });
  const d = deps(db);
  expect(await deliverTenantDigest(d.value, tenantA, EIGHT_AM_ROME)).toBe('accepted');
  expect(rpcCalls).toEqual([{ name: 'claim_tenant_daily_digest', args: { p_tenant: TENANT_A, p_date: '2026-09-26' } }]);
  expect(d.recipientLookups).toEqual([TENANT_A]);
  expect(d.notified).toHaveLength(1);
  expect(d.notified[0]!.idempotencyKey).toBe(TENANT_A + ':2026-09-26');
  expect(d.notified[0]!.recipients).toEqual(['ops@example.com']);
  // Tenant isolation: every data read/write is scoped to the tenant being processed.
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) expect(hasOp(call, 'eq', 'tenant_id', TENANT_A), call.table).toBe(true);
  expect(calls.some((call) => JSON.stringify(call.ops).includes(TENANT_B))).toBe(false);
  const accepted = calls.find((call) => call.table === 'tenant_daily_digest_runs' && call.ops.some(([op]) => op === 'update'))!;
  expect(hasOp(accepted, 'eq', 'status', 'processing')).toBe(true);
});

test('empty day is skipped unless include_empty is configured', async () => {
  const empty = { orders: () => ({ data: [], error: null }), checkout_sessions: () => ({ data: [], error: null }) };
  const skipped = fakeDb(empty);
  const d1 = deps(skipped.db);
  expect(await deliverTenantDigest(d1.value, tenantA, EIGHT_AM_ROME)).toBe('empty');
  expect(d1.notified).toHaveLength(0);

  const sent = fakeDb(empty);
  const d2 = deps(sent.db);
  expect(await deliverTenantDigest(d2.value, { tenantId: TENANT_A, config: { ...DAILY_DIGEST_DEFAULTS, include_empty: true } }, EIGHT_AM_ROME)).toBe('accepted');
  expect(d2.notified).toHaveLength(1);
});

test('n8n refusal marks the run failed so it can be retried', async () => {
  const { db, calls } = fakeDb({ orders: () => ({ data: [paidOrder], error: null }), checkout_sessions: () => ({ data: [], error: null }) });
  const d = deps(db, { notify: async () => false });
  expect(await deliverTenantDigest(d.value, tenantA, EIGHT_AM_ROME)).toBe('failed');
  const failed = calls.find((call) => call.table === 'tenant_daily_digest_runs' && call.ops.some(([op, args]) => op === 'update' && (args[0] as { status?: string }).status === 'failed'));
  expect(failed).toBeTruthy();
});

test('configured timezone decides when a tenant is due', async () => {
  const { db } = fakeDb({ orders: () => ({ data: [paidOrder], error: null }), checkout_sessions: () => ({ data: [], error: null }) });
  const ny = { tenantId: TENANT_A, config: { ...DAILY_DIGEST_DEFAULTS, timezone: 'America/New_York' } };
  expect(await deliverTenantDigest(deps(db).value, ny, EIGHT_AM_ROME)).toBe('not_due');
  expect(await deliverTenantDigest(deps(db).value, ny, new Date('2026-09-26T12:00:00Z'))).toBe('accepted');
});
