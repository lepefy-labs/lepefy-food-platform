import { expect, test } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  dispatchDueDeliveries,
  retryDelayMinutes,
  sendWithLedger,
  summarizePayload,
} from '../../src/lib/notifications/deliveryLedger';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

type Row = Record<string, unknown>;

/** Just enough of the supabase-js query builder for the ledger. */
function fakeDb(options: { rows?: Row[]; missingTable?: boolean; claim?: Row[] } = {}) {
  const rows: Row[] = options.rows ?? [];
  const updates: Array<{ id: unknown; patch: Row }> = [];
  const db = {
    from() {
      return {
        upsert(row: Row) {
          return {
            select: async () => {
              if (options.missingTable) return { data: null, error: { code: 'PGRST205', message: 'notification_deliveries' } };
              const exists = rows.find((r) => r.tenant_id === row.tenant_id && r.idempotency_key === row.idempotency_key);
              if (exists) return { data: [], error: null };
              const created = { id: `d${rows.length + 1}`, max_attempts: 5, ...row };
              rows.push(created);
              return { data: [created], error: null };
            },
          };
        },
        select() {
          const filters: Row = {};
          const chain = {
            eq(column: string, value: unknown) { filters[column] = value; return chain; },
            maybeSingle: async () => ({
              data: rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v)) ?? null, error: null,
            }),
          };
          return chain;
        },
        update(patch: Row) {
          return {
            eq: async (_column: string, id: unknown) => {
              updates.push({ id, patch });
              const row = rows.find((r) => r.id === id);
              if (row) Object.assign(row, patch);
              return { error: null };
            },
          };
        },
        delete() { return { in: () => ({ lt: async () => ({ error: null }) }) }; },
      };
    },
    rpc: async () => ({ data: options.claim ?? [], error: null }),
  };
  return { db: db as unknown as SupabaseClient, rows, updates };
}

const ledger = { tenantId: 't1', idempotencyKey: 'order-confirmed:o1', notificationType: 'order_confirmed' };

test('first send is recorded, accepted and its payload cleared', async () => {
  const fx = fakeDb();
  const sent: string[] = [];
  const ok = await sendWithLedger('/webhook/order-confirmed', { email: 'a@b.it' }, ledger,
    async (path) => { sent.push(path); return true; }, fx.db);
  expect(ok).toBe(true);
  expect(sent).toEqual(['/webhook/order-confirmed']);
  expect(fx.rows[0]).toMatchObject({ status: 'accepted', payload: null, recipients: ['a@b.it'] });
});

test('a key already recorded is never sent again', async () => {
  const fx = fakeDb({ rows: [{ id: 'd1', tenant_id: 't1', idempotency_key: 'order-confirmed:o1', status: 'accepted' }] });
  let calls = 0;
  const ok = await sendWithLedger('/webhook/order-confirmed', {}, ledger, async () => { calls += 1; return true; }, fx.db);
  expect(calls).toBe(0);
  expect(ok).toBe(true);
});

test('without migration 136 the notification is still sent directly', async () => {
  const fx = fakeDb({ missingTable: true });
  let calls = 0;
  expect(await sendWithLedger('/webhook/order-confirmed', {}, ledger, async () => { calls += 1; return true; }, fx.db)).toBe(true);
  expect(calls).toBe(1);
});

test('a failed send keeps the payload and schedules a retry with backoff', async () => {
  const fx = fakeDb();
  const before = Date.now();
  expect(await sendWithLedger('/webhook/order-confirmed', { email: 'a@b.it' }, ledger, async () => false, fx.db)).toBe(false);
  const row = fx.rows[0]!;
  expect(row.status).toBe('failed');
  expect(row.payload).toEqual({ email: 'a@b.it' });
  expect(Date.parse(String(row.next_attempt_at)) - before).toBeGreaterThanOrEqual(60_000);
  expect(retryDelayMinutes(1)).toBe(1);
  expect(retryDelayMinutes(5)).toBe(240);
  expect(retryDelayMinutes(9)).toBe(240);
});

test('the scheduler retries claimed rows and marks exhausted ones dead', async () => {
  const claim = [
    { id: 'r1', tenant_id: 't1', webhook_path: '/webhook/send-email', payload: { subject: 'x' }, attempts: 2, max_attempts: 5 },
    { id: 'r2', tenant_id: 't1', webhook_path: '/webhook/send-email', payload: { subject: 'y' }, attempts: 5, max_attempts: 5 },
  ];
  const fx = fakeDb({ claim });
  const result = await dispatchDueDeliveries(async (_path, payload) => payload.subject === 'x', fx.db);
  expect(result).toEqual({ claimed: 2, accepted: 1, failed: 1 });
  expect(fx.updates.find((u) => u.id === 'r1')!.patch).toMatchObject({ status: 'accepted', payload: null });
  expect(fx.updates.find((u) => u.id === 'r2')!.patch).toMatchObject({ status: 'dead' });
});

test('history summary reads subject and recipients from the known payload shapes', () => {
  expect(summarizePayload({ subject: 'S', recipients: ['a@b.it', 'x'] })).toEqual({ subject: 'S', recipients: ['a@b.it'] });
  expect(summarizePayload({ email: 'c@d.it' })).toEqual({ subject: null, recipients: ['c@d.it'] });
  expect(summarizePayload({ customerEmail: 'e@f.it', email: { subject: 'Invite' } })).toEqual({ subject: 'Invite', recipients: ['e@f.it'] });
});

test('delivery history and manual retry are mapped to tenant settings permissions', () => {
  expect(permissionForAdminApi('/api/admin/notification-deliveries', 'GET')).toBe('tenant_settings.view');
  expect(permissionForAdminApi('/api/admin/notification-deliveries', 'DELETE')).toBeNull();
  expect(permissionForAdminApi('/api/admin/notification-deliveries/abc/retry', 'POST')).toBe('tenant_settings.manage');
  expect(permissionForAdminApi('/api/admin/notification-deliveries/abc/retry', 'GET')).toBeNull();
});
