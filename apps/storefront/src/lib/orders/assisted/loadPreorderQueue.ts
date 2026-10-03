import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssistedCartLine, CheckoutSessionStatus, SalesChannel } from '@lepefy/types';
import { computePreorderTotals, preorderReference } from '@/lib/orders/assisted/assistedOrderPolicy';
import {
  ACTIVE_PREORDER_STATUSES, TO_TREAT_GROUPS, classifyPreorder, comparePreorders, preorderReferenceRange,
  type PreorderGroup, type PreorderOperation, type PreorderQueueInput, type PreorderView,
} from '@/lib/orders/assisted/preorderQueue';

// Server loader of Admin → Précommandes. Active preorders (draft, open,
// awaiting_verification, expired) are read once (bounded set: links last 72 h,
// drafts 30 days), classified, sorted BEFORE pagination and counted for the
// KPIs; completed/cancelled views are paginated by the database. `link_opened`
// events are read in one batch for the rows of the page only.

export const ACTIVE_PREORDER_LIMIT = 1000;
const ID_CHUNK = 200;

const COLUMNS = 'id, status, full_name, email, phone, sales_channel, items, shipping_total, ambassador_discount_amount, '
  + 'fulfillment_type, created_at, updated_at, expires_at, order_id, external_payment_type, external_payment_label, '
  + 'declared_payment_at, pay_token_hash, pay_token_issued_at, shipping_details';

interface Row {
  id: string; status: CheckoutSessionStatus; full_name: string | null; email: string | null; phone: string | null;
  sales_channel: SalesChannel | null; items: AssistedCartLine[] | null; shipping_total: number | null;
  ambassador_discount_amount: number | null; fulfillment_type: 'delivery' | 'pickup'; created_at: string; updated_at: string;
  expires_at: string | null; order_id: string | null; external_payment_type: string | null; external_payment_label: string | null;
  declared_payment_at: string | null; pay_token_hash: string | null; pay_token_issued_at: string | null;
  shipping_details: { quotePending?: boolean } | null;
}

export interface PreorderQueueItem {
  id: string;
  reference: string;
  status: CheckoutSessionStatus;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  salesChannel: SalesChannel | null;
  fulfillmentType: 'delivery' | 'pickup';
  itemCount: number;
  total: number;
  createdAt: string;
  expiresAt: string | null;
  orderId: string | null;
  hasActiveLink: boolean;
  declaredPayment: string | null;
  group: PreorderGroup;
  action: PreorderOperation['action'];
  context: string | null;
  warning: string | null;
}

export interface PreorderQueueResult {
  preorders: PreorderQueueItem[];
  total: number;
  page: number;
  totalPages: number;
  /** Tenant-wide counts of the active queue, by group. */
  kpis: Record<'to_verify' | 'expired' | 'draft' | 'waiting', number>;
  toTreatCount: number;
  finishedCounts: { completed: number; cancelled: number };
  /** False when more than ACTIVE_PREORDER_LIMIT active preorders exist. */
  complete: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

function toInput(row: Row): PreorderQueueInput {
  return {
    id: row.id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, expiresAt: row.expires_at,
    declaredAt: row.declared_payment_at, declaredLabel: row.external_payment_label ?? row.external_payment_type,
    linkIssuedAt: row.pay_token_issued_at, shippingPending: row.shipping_details?.quotePending === true,
  };
}

function matchesSearch(row: Row, q: string): boolean {
  const range = preorderReferenceRange(q);
  if (range) return row.id >= range.from && row.id <= range.to;
  const needle = q.toLowerCase();
  return [row.full_name, row.email, row.phone].some((value) => value?.toLowerCase().includes(needle));
}

function applySearch(query: Query, q: string): Query {
  if (!q) return query;
  const range = preorderReferenceRange(q);
  if (range) return query.gte('id', range.from).lte('id', range.to);
  const escaped = q.replace(/[%_,()]/g, '');
  return query.or(`full_name.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${escaped}%`);
}

async function lastOpenedBySession(db: SupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let index = 0; index < ids.length; index += ID_CHUNK) {
    const { data, error } = await db.from('assisted_order_events').select('checkout_session_id, created_at')
      .eq('tenant_id', tenantId).eq('event_type', 'link_opened').in('checkout_session_id', ids.slice(index, index + ID_CHUNK))
      .order('created_at', { ascending: false });
    if (error) throw error;
    for (const event of (data ?? []) as Array<{ checkout_session_id: string; created_at: string }>) {
      if (!result.has(event.checkout_session_id)) result.set(event.checkout_session_id, event.created_at);
    }
  }
  return result;
}

function toItem(row: Row, operation: PreorderOperation): PreorderQueueItem {
  return {
    id: row.id,
    reference: preorderReference(row.id),
    status: row.status,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    salesChannel: row.sales_channel,
    fulfillmentType: row.fulfillment_type,
    itemCount: (row.items ?? []).reduce((sum, item) => sum + item.quantity, 0),
    total: computePreorderTotals(row.items ?? [], row.shipping_total ?? 0, row.ambassador_discount_amount).total,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    orderId: row.order_id,
    hasActiveLink: Boolean(row.pay_token_hash) && row.status === 'open',
    declaredPayment: row.status === 'awaiting_verification' ? row.external_payment_label ?? row.external_payment_type : null,
    group: operation.group,
    action: operation.action,
    context: operation.context,
    warning: operation.warning,
  };
}

export async function loadPreorderQueue(db: SupabaseClient, tenantId: string, input: {
  view: PreorderView; q: string; page: number; pageSize: number; now: Date;
}): Promise<PreorderQueueResult> {
  const { view, q, pageSize, now } = input;
  const base = (columns: string, options?: { count: 'exact'; head?: boolean }): Query =>
    db.from('checkout_sessions').select(columns, options).eq('tenant_id', tenantId).eq('origin', 'assisted');

  const [activeResult, completedCount, cancelledCount] = await Promise.all([
    base(COLUMNS).in('status', ACTIVE_PREORDER_STATUSES).order('created_at', { ascending: true }).order('id').limit(ACTIVE_PREORDER_LIMIT + 1),
    applySearch(base('id', { count: 'exact', head: true }).eq('status', 'completed'), q),
    applySearch(base('id', { count: 'exact', head: true }).eq('status', 'cancelled'), q),
  ]);
  if (activeResult.error) throw activeResult.error;
  if (completedCount.error) throw completedCount.error;
  if (cancelledCount.error) throw cancelledCount.error;
  const activeRows = ((activeResult.data ?? []) as Row[]).slice(0, ACTIVE_PREORDER_LIMIT);
  const complete = (activeResult.data ?? []).length <= ACTIVE_PREORDER_LIMIT;

  const classified = activeRows.map((row) => ({ row, input: toInput(row), operation: classifyPreorder(toInput(row), now) }));
  const kpis = { to_verify: 0, expired: 0, draft: 0, waiting: 0 };
  for (const { operation } of classified) if (operation.group !== 'finished') kpis[operation.group] += 1;
  const finishedCounts = { completed: completedCount.count ?? 0, cancelled: cancelledCount.count ?? 0 };

  const pageOf = (total: number) => {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(Math.max(1, input.page), totalPages);
    return { page, totalPages, from: (page - 1) * pageSize };
  };

  // Page rows are re-classified with their `link_opened` events (relance hints).
  const finish = async (rows: Row[]) => {
    const opened = await lastOpenedBySession(db, tenantId, rows.filter((row) => row.status === 'open' || row.status === 'expired').map((row) => row.id));
    return rows.map((row) => toItem(row, classifyPreorder({ ...toInput(row), lastOpenedAt: opened.get(row.id) ?? null }, now)));
  };

  const activeMatching = classified
    .filter(({ row, operation }) => (!q || matchesSearch(row, q))
      && (view === 'all' || (view === 'waiting' ? operation.group === 'waiting' : view === 'to_treat' ? TO_TREAT_GROUPS.includes(operation.group) : false)))
    .sort(comparePreorders);

  const common = { kpis, toTreatCount: kpis.to_verify + kpis.expired + kpis.draft, finishedCounts, complete };

  if (view === 'to_treat' || view === 'waiting') {
    const { page, totalPages, from } = pageOf(activeMatching.length);
    return { ...common, preorders: await finish(activeMatching.slice(from, from + pageSize).map(({ row }) => row)), total: activeMatching.length, page, totalPages };
  }

  // completed / cancelled / all: finished preorders come from the database (most recent first).
  const finishedStatuses: CheckoutSessionStatus[] = view === 'completed' ? ['completed'] : view === 'cancelled' ? ['cancelled'] : ['completed', 'cancelled'];
  const finishedTotal = finishedStatuses.reduce((sum, status) => sum + finishedCounts[status as 'completed' | 'cancelled'], 0);
  const activeCount = view === 'all' ? activeMatching.length : 0;
  const total = activeCount + finishedTotal;
  const { page, totalPages, from } = pageOf(total);
  const activeSlice = view === 'all' ? activeMatching.slice(from, from + pageSize).map(({ row }) => row) : [];
  const remaining = pageSize - activeSlice.length;
  let finishedRows: Row[] = [];
  if (remaining > 0 && finishedTotal > 0) {
    const offset = Math.max(0, from - activeCount);
    const { data, error } = await applySearch(base(COLUMNS).in('status', finishedStatuses), q)
      .order('updated_at', { ascending: false }).order('id').range(offset, offset + remaining - 1);
    if (error) throw error;
    finishedRows = (data ?? []) as Row[];
  }
  return { ...common, preorders: await finish([...activeSlice, ...finishedRows]), total, page, totalPages };
}
