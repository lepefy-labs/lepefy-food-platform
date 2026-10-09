import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyOrderOperation, compareOrders,
  type OperationalOrder, type OperationalThresholds, type OrderSortKey, type PrioritizedOrder, type QueueKey,
} from '@/lib/orders/adminOrderOperations';

// Server-side loader of Admin → Commandes. Strategy (no migration):
//  1. one light read of the tenant's ACTIVE orders (status/timestamps/snapshot
//     columns, no items) → KPIs + classified views + "Priorité opérationnelle";
//  2. tracking events only for moving shipments (stale detection), in batches;
//  3. sorting happens BEFORE pagination: the page window takes active ids from
//     the sorted set, then terminal orders straight from the DB (updated_at desc);
//  4. full rows (with items) only for the ≤ pageSize ids of the page.
// Every query is tenant-scoped; no provider is called.

export type OrderView = '' | QueueKey | 'payment_pending' | 'aged' | 'picking_incomplete' | 'packing_pending' | 'tracking_missing';

export const ORDER_VIEWS: readonly OrderView[] = ['', 'to_treat', 'preparing', 'to_ship', 'in_transit', 'incidents', 'pickup_ready', 'urgent', 'finished', 'payment_pending', 'aged', 'picking_incomplete', 'packing_pending', 'tracking_missing'];

/** Views answered by the classifier on the active set (same rules as the KPIs). */
const CLASSIFIED_VIEWS = new Set<OrderView>(['to_treat', 'preparing', 'to_ship', 'in_transit', 'incidents', 'pickup_ready', 'urgent']);

export const KPI_KEYS: readonly QueueKey[] = ['to_treat', 'preparing', 'to_ship', 'in_transit', 'incidents', 'pickup_ready', 'urgent'];

/** Safety cap of the in-memory active set; beyond it the list falls back to date order. */
export const ACTIVE_ORDER_LIMIT = 5000;
const AGED_MS = 24 * 60 * 60 * 1000;
const ID_CHUNK = 200;

export interface OrderListFilters {
  status: string;
  dateFrom: string;
  dateTo: string;
  fulfillment: string;
  payment: string;
  search: string;
  view: OrderView;
}

const LIGHT_SELECT = 'id, status, fulfillment_type, payment_status, created_at, updated_at, total, shipped_at, '
  + 'picking_started_at, picking_completed_at, packing_completed_at, shipping_tracking_mode, shipping_provider_reference, '
  + 'shipping_normalized_status, shipping_sync_error, shipping_estimated_delivery_at, tracking_code, shipping_address, order_items(storage_type)';

const FULL_SELECT = `
  id, created_at, updated_at, email, full_name, status, total,
  subtotal, shipping_cost, payment_method, payment_status,
  fulfillment_type, shipping_address, shipping_details,
  tracking_code, tracking_carrier, shipping_tracking_url, shipping_tracking_mode,
  shipping_provider_key, shipping_provider_reference, shipping_normalized_status,
  shipping_provider_synced_at, shipping_sync_error, shipped_at,
  shipping_estimated_delivery_at, picking_started_at, picking_completed_at,
  packing_completed_at, packing_parcel_count,
  order_items(id, name, quantity, subtotal, storage_type, warehouse_location)
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

function hasListFilters(filters: OrderListFilters): boolean {
  return Boolean(filters.status || filters.dateFrom || filters.dateTo || filters.fulfillment || filters.payment || filters.search
    || (filters.view && !CLASSIFIED_VIEWS.has(filters.view) && filters.view !== 'finished'));
}

/** DB filters shared by every read (classified views are applied in memory). */
export function applyOrderFilters(query: Query, filters: OrderListFilters, now: Date): Query {
  let q = query;
  const view = filters.view;
  if (view === 'finished') q = q.in('status', ['delivered', 'cancelled']);
  else if (view === 'payment_pending') q = q.eq('payment_status', 'pending');
  else if (view === 'aged') q = q.lte('created_at', new Date(now.getTime() - AGED_MS).toISOString()).not('status', 'in', '(delivered,cancelled)');
  else if (view === 'picking_incomplete') q = q.eq('status', 'preparing').is('picking_completed_at', null);
  else if (view === 'packing_pending') q = q.eq('status', 'preparing').eq('fulfillment_type', 'delivery').not('picking_completed_at', 'is', null).is('packing_completed_at', null);
  else if (view === 'tracking_missing') q = q.eq('status', 'preparing').eq('fulfillment_type', 'delivery').not('packing_completed_at', 'is', null).is('tracking_code', null);
  else if (!view && filters.status) q = q.eq('status', filters.status);
  if (filters.fulfillment) q = q.eq('fulfillment_type', filters.fulfillment);
  if (filters.payment) q = q.eq('payment_method', filters.payment);
  if (filters.dateFrom) q = q.gte('created_at', new Date(filters.dateFrom).toISOString());
  if (filters.dateTo) {
    const end = new Date(filters.dateTo);
    end.setHours(23, 59, 59, 999);
    q = q.lte('created_at', end.toISOString());
  }
  const search = filters.search;
  if (search) {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search)) q = q.eq('id', search);
    else if (/^#?[0-9a-f]{8}$/i.test(search)) {
      const prefix = search.replace(/^#/, '').toLowerCase();
      q = q.gte('id', `${prefix}-0000-0000-0000-000000000000`).lte('id', `${prefix}-ffff-ffff-ffff-ffffffffffff`);
    } else {
      const escaped = search.replace(/[%_,()]/g, '');
      q = q.or(`full_name.ilike.%${escaped}%,email.ilike.%${escaped}%`);
    }
  }
  return q;
}

function orderByDb(query: Query, sort: OrderSortKey): Query {
  if (sort === 'oldest') return query.order('created_at', { ascending: true }).order('id');
  if (sort === 'amount_desc') return query.order('total', { ascending: false }).order('created_at', { ascending: false }).order('id');
  if (sort === 'amount_asc') return query.order('total', { ascending: true }).order('created_at', { ascending: false }).order('id');
  if (sort === 'priority') return query.order('updated_at', { ascending: false }).order('id'); // terminal part only
  return query.order('created_at', { ascending: false }).order('id');
}

export interface PageWindow { currentPage: number; totalPages: number; activeStart: number; activeEnd: number; terminalFrom: number; terminalCount: number }

/** Page window over [sorted active orders][terminal orders], computed before any row is fetched. */
export function planPriorityPage(activeCount: number, terminalCount: number, requestedPage: number, pageSize: number): PageWindow {
  const total = activeCount + terminalCount;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (currentPage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const activeStart = Math.min(start, activeCount);
  const activeEnd = Math.min(end, activeCount);
  return { currentPage, totalPages, activeStart, activeEnd, terminalFrom: Math.max(0, start - activeCount), terminalCount: Math.max(0, end - Math.max(start, activeCount)) };
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function loadTrackingEvents(db: SupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, unknown>> {
  const events = new Map<string, unknown>();
  for (const batch of chunks(Array.from(new Set(ids)), ID_CHUNK)) {
    const { data, error } = await db.from('orders').select('id, shipping_tracking_events').eq('tenant_id', tenantId).in('id', batch);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ id: string; shipping_tracking_events: unknown }>) events.set(row.id, row.shipping_tracking_events);
  }
  return events;
}

async function loadActive(db: SupabaseClient, tenantId: string, filters: OrderListFilters | null, now: Date) {
  let query: Query = db.from('orders').select(LIGHT_SELECT).eq('tenant_id', tenantId).not('status', 'in', '(delivered,cancelled)');
  if (filters) query = applyOrderFilters(query, filters, now);
  const { data, error } = await query.order('created_at', { ascending: true }).order('id').limit(ACTIVE_ORDER_LIMIT + 1);
  if (error) throw error;
  const rows = (data ?? []) as OperationalOrder[];
  return { rows: rows.slice(0, ACTIVE_ORDER_LIMIT), overflow: rows.length > ACTIVE_ORDER_LIMIT };
}

const needsEvents = (order: OperationalOrder) => order.status === 'shipped' && order.fulfillment_type === 'delivery'
  && Boolean(order.shipping_provider_reference) && ['in_transit', 'out_for_delivery'].includes(order.shipping_normalized_status ?? '');

export interface WorkQueueInput {
  filters: OrderListFilters;
  sort: OrderSortKey;
  page: number;
  pageSize: number;
  thresholds: OperationalThresholds;
  now: Date;
  managedProviderAvailable: boolean;
  originCountry: string;
}

export interface WorkQueueResult {
  rows: Array<Record<string, unknown>>;
  total: number;
  currentPage: number;
  totalPages: number;
  /** Tenant-wide counts of the active work queue, by queue key. */
  kpis: Record<QueueKey, number>;
  /** Active orders by status (stock conflicts are not in the stats view). */
  activeStatusCounts: Record<string, number>;
  /** False when the active set exceeded ACTIVE_ORDER_LIMIT: the list then uses date order. */
  priorityAvailable: boolean;
  /** Sort actually applied (priority may fall back to newest). */
  appliedSort: OrderSortKey;
}

export async function loadOrderWorkQueue(db: SupabaseClient, tenantId: string, input: WorkQueueInput): Promise<WorkQueueResult> {
  const { filters, pageSize, thresholds, now } = input;
  const filtered = hasListFilters(filters);
  const all = await loadActive(db, tenantId, null, now);
  const scoped = filtered ? await loadActive(db, tenantId, filters, now) : all;
  const overflow = all.overflow || scoped.overflow;

  const events = await loadTrackingEvents(db, tenantId, [...all.rows, ...(filtered ? scoped.rows : [])].filter(needsEvents).map((row) => row.id!));
  const classify = (row: OperationalOrder): PrioritizedOrder => {
    const order = { ...row, originCountry: input.originCountry, managedProviderAvailable: input.managedProviderAvailable, shipping_tracking_events: (events.get(row.id!) ?? null) as OperationalOrder['shipping_tracking_events'] };
    return { order, operation: classifyOrderOperation(order, thresholds, now) };
  };
  const allClassified = all.rows.map(classify);
  const scopedClassified = filtered ? scoped.rows.map(classify) : allClassified;

  const kpis = Object.fromEntries(KPI_KEYS.map((key) => [key, 0])) as Record<QueueKey, number>;
  const activeStatusCounts: Record<string, number> = {};
  for (const { order, operation } of allClassified) {
    operation.flags.forEach((flag) => { if (flag in kpis) kpis[flag] += 1; });
    activeStatusCounts[order.status] = (activeStatusCounts[order.status] ?? 0) + 1;
  }

  const sort: OrderSortKey = input.sort === 'priority' && overflow ? 'newest' : input.sort;
  const base = { kpis, activeStatusCounts, priorityAvailable: !overflow, appliedSort: sort };

  // Classified view: the answer is the (filtered) active set itself.
  if (CLASSIFIED_VIEWS.has(filters.view)) {
    const matching = scopedClassified.filter(({ operation }) => operation.flags.has(filters.view as QueueKey))
      .sort((a, b) => compareOrders(sort, a, b));
    const window = planPriorityPage(matching.length, 0, input.page, pageSize);
    const ids = matching.slice(window.activeStart, window.activeEnd).map(({ order }) => order.id!);
    return { ...base, rows: await loadFullRows(db, tenantId, ids), total: matching.length, currentPage: window.currentPage, totalPages: window.totalPages };
  }

  // Priority on the whole list: sorted active orders first, then terminal ones.
  if (sort === 'priority' && filters.view !== 'finished') {
    const active = [...scopedClassified].sort((a, b) => compareOrders('priority', a, b));
    const terminalQuery = applyOrderFilters(db.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('status', ['delivered', 'cancelled']), filters, now);
    const { count: terminalTotal, error: countError } = await terminalQuery;
    if (countError) throw countError;
    const window = planPriorityPage(active.length, terminalTotal ?? 0, input.page, pageSize);
    const activeIds = active.slice(window.activeStart, window.activeEnd).map(({ order }) => order.id!);
    let terminalRows: Array<Record<string, unknown>> = [];
    if (window.terminalCount > 0) {
      const query = applyOrderFilters(db.from('orders').select(FULL_SELECT).eq('tenant_id', tenantId).in('status', ['delivered', 'cancelled']), filters, now);
      const { data, error } = await orderByDb(query, 'priority').range(window.terminalFrom, window.terminalFrom + window.terminalCount - 1);
      if (error) throw error;
      terminalRows = await attachEvents(db, tenantId, (data ?? []) as Array<Record<string, unknown>>);
    }
    return {
      ...base,
      rows: [...await loadFullRows(db, tenantId, activeIds), ...terminalRows],
      total: active.length + (terminalTotal ?? 0),
      currentPage: window.currentPage,
      totalPages: window.totalPages,
    };
  }

  // Plain DB order (date/amount sorts, "Terminés"), paginated by the database.
  const query = applyOrderFilters(db.from('orders').select(FULL_SELECT, { count: 'exact' }).eq('tenant_id', tenantId), filters, now);
  const first = await orderByDb(query, sort).range((Math.max(1, input.page) - 1) * pageSize, Math.max(1, input.page) * pageSize - 1);
  if (first.error) throw first.error;
  const total = first.count ?? 0;
  const window = planPriorityPage(total, 0, input.page, pageSize);
  let data = (first.data ?? []) as Array<Record<string, unknown>>;
  if (window.currentPage !== Math.max(1, input.page)) {
    const from = (window.currentPage - 1) * pageSize;
    const retry = await orderByDb(applyOrderFilters(db.from('orders').select(FULL_SELECT).eq('tenant_id', tenantId), filters, now), sort).range(from, from + pageSize - 1);
    if (retry.error) throw retry.error;
    data = (retry.data ?? []) as Array<Record<string, unknown>>;
  }
  return { ...base, rows: await attachEvents(db, tenantId, data), total, currentPage: window.currentPage, totalPages: window.totalPages };
}

/** Full rows of the page, in the given order, with their tracking events. */
async function loadFullRows(db: SupabaseClient, tenantId: string, ids: string[]): Promise<Array<Record<string, unknown>>> {
  if (ids.length === 0) return [];
  const { data, error } = await db.from('orders').select(FULL_SELECT).eq('tenant_id', tenantId).in('id', ids);
  if (error) throw error;
  const byId = new Map(((data ?? []) as Array<Record<string, unknown>>).map((row) => [row.id as string, row]));
  return attachEvents(db, tenantId, ids.map((id) => byId.get(id)).filter((row): row is Record<string, unknown> => Boolean(row)));
}

async function attachEvents(db: SupabaseClient, tenantId: string, rows: Array<Record<string, unknown>>) {
  const tracked = rows.filter((row) => row.fulfillment_type === 'delivery' && row.shipping_provider_reference).map((row) => row.id as string);
  if (tracked.length === 0) return rows;
  const events = await loadTrackingEvents(db, tenantId, tracked);
  return rows.map((row) => ({ ...row, shipping_tracking_events: events.get(row.id as string) ?? null }));
}
