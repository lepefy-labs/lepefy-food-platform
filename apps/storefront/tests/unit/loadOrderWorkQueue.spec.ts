import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadOrderWorkQueue, planPriorityPage, type OrderListFilters } from '../../src/lib/orders/loadOrderWorkQueue';

const TENANT = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-02T12:00:00Z');
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const thresholds = { prepareHours: 24, pickupHours: 48, trackingStaleHours: 72 };
const noFilters: OrderListFilters = { view: '', status: '', dateFrom: '', dateTo: '', fulfillment: '', payment: '', search: '' };

const activeRow = (id: string, patch: Record<string, unknown>) => ({
  id, status: 'new', fulfillment_type: 'delivery', payment_status: 'paid', created_at: hoursAgo(2), updated_at: hoursAgo(2), total: 20,
  shipped_at: null, picking_started_at: null, picking_completed_at: null, packing_completed_at: null, shipping_tracking_mode: 'manual',
  shipping_provider_reference: null, shipping_normalized_status: null, shipping_sync_error: null, shipping_estimated_delivery_at: null, tracking_code: null,
  ...patch,
});
const ACTIVE = [
  activeRow('a-new', {}),
  activeRow('b-late', { status: 'preparing', picking_started_at: hoursAgo(50), created_at: hoursAgo(60) }),
  activeRow('c-incident', { status: 'shipped', shipping_provider_reference: 'PK1', tracking_code: 'T1', shipping_normalized_status: 'exception' }),
  activeRow('d-transit', { status: 'shipped', shipping_provider_reference: 'PK2', tracking_code: 'T2', shipping_normalized_status: 'in_transit', shipped_at: hoursAgo(20) }),
];
const TERMINAL = ['t1', 't2', 't3'].map((id, index) => ({ id, status: 'delivered', fulfillment_type: 'pickup', updated_at: hoursAgo(index + 1), order_items: [] }));

type Op = [string, unknown[]];
/** Chainable Supabase double: records every query, answers from the fixtures above. */
function fakeDb() {
  const queries: Op[][] = [];
  const db = {
    from(table: string) {
      const ops: Op[] = [['from', [table]]];
      queries.push(ops);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'not', 'in', 'or', 'gte', 'lte', 'is', 'order', 'limit', 'range']) {
        builder[method] = (...args: unknown[]) => { ops.push([method, args]); return builder; };
      }
      builder.then = (resolve: (value: unknown) => void) => resolve(answer(ops));
      return builder;
    },
  } as unknown as SupabaseClient;
  return { db, queries };
}
function answer(ops: Op[]) {
  const select = ops.find(([m]) => m === 'select')!;
  const columns = String(select[1][0]);
  const head = (select[1][1] as { head?: boolean } | undefined)?.head;
  const idsFilter = ops.find(([m, args]) => m === 'in' && args[0] === 'id')?.[1][1] as string[] | undefined;
  if (columns === 'id, shipping_tracking_events') return { data: (idsFilter ?? []).map((id) => ({ id, shipping_tracking_events: [] })), error: null };
  if (head) return { data: null, count: TERMINAL.length, error: null };
  if (columns.includes('order_items')) {
    if (idsFilter) return { data: ACTIVE.filter((row) => idsFilter.includes(row.id)).map((row) => ({ ...row, order_items: [] })), error: null };
    const range = ops.find(([m]) => m === 'range')?.[1] as [number, number];
    return { data: TERMINAL.slice(range[0], range[1] + 1), count: TERMINAL.length, error: null };
  }
  return { data: ACTIVE, error: null };
}
const input = (patch: Partial<Parameters<typeof loadOrderWorkQueue>[2]> = {}) => ({
  filters: noFilters, sort: 'priority' as const, page: 1, pageSize: 3, thresholds, now, managedProviderAvailable: false, ...patch,
});

test('page window is planned on [sorted active][terminal] before fetching rows', () => {
  expect(planPriorityPage(4, 3, 1, 3)).toMatchObject({ currentPage: 1, totalPages: 3, activeStart: 0, activeEnd: 3, terminalCount: 0 });
  expect(planPriorityPage(4, 3, 2, 3)).toMatchObject({ activeStart: 3, activeEnd: 4, terminalFrom: 0, terminalCount: 2 });
  expect(planPriorityPage(4, 3, 3, 3)).toMatchObject({ activeStart: 4, activeEnd: 4, terminalFrom: 2, terminalCount: 1 });
  expect(planPriorityPage(4, 3, 99, 3).currentPage).toBe(3);
  expect(planPriorityPage(0, 0, 1, 50)).toMatchObject({ currentPage: 1, totalPages: 1, terminalCount: 0 });
});

test('priority sorts the whole active set before pagination, then continues with terminal orders', async () => {
  const { db } = fakeDb();
  const first = await loadOrderWorkQueue(db, TENANT, input());
  expect(first.rows.map((row) => row.id)).toEqual(['c-incident', 'b-late', 'a-new']);
  expect(first.total).toBe(7);
  const second = await loadOrderWorkQueue(db, TENANT, input({ page: 2 }));
  expect(second.rows.map((row) => row.id)).toEqual(['d-transit', 't1', 't2']);
  expect(second.appliedSort).toBe('priority');
});

test('KPIs and classified views share the classifier', async () => {
  const { db } = fakeDb();
  const result = await loadOrderWorkQueue(db, TENANT, input({ filters: { ...noFilters, view: 'urgent' }, pageSize: 50 }));
  expect(result.kpis).toMatchObject({ to_treat: 3, incidents: 1, urgent: 2, in_transit: 1, preparing: 1 });
  expect(result.rows.map((row) => row.id)).toEqual(['c-incident', 'b-late']);
  expect(result.total).toBe(2);
});

test('every query is tenant-scoped', async () => {
  const { db, queries } = fakeDb();
  await loadOrderWorkQueue(db, TENANT, input({ page: 2 }));
  await loadOrderWorkQueue(db, TENANT, input({ sort: 'newest', filters: { ...noFilters, search: 'Vera' } }));
  expect(queries.length).toBeGreaterThan(4);
  for (const ops of queries) {
    expect(ops.some(([method, args]) => method === 'eq' && args[0] === 'tenant_id' && args[1] === TENANT)).toBe(true);
  }
});
