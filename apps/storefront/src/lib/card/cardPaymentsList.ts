import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cardPaymentReference } from '@/lib/card/cardPaymentOutcome';
import {
  CARD_PAYMENTS_PAGE_SIZE, cardNotificationState, cardPaymentDeliveryKeys, displayStatus, periodBounds, referenceRange, sanitizeSearch,
  stripeDashboardUrl, type CardNotificationState, type CardPaymentDisplayStatus, type CardPaymentsListState,
} from '@/lib/card/cardPaymentsAdmin';

interface CardPaymentRow {
  id: string;
  amount: number;
  currency: string;
  customer_name: string | null;
  customer_email: string | null;
  stripe_payment_intent_id: string | null;
  status: string;
  created_at: string;
  paid_at: string | null;
}

export interface CardNotificationInfo { state: CardNotificationState; acceptedAt: string | null }

export interface CardPaymentListItem {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  status: CardPaymentDisplayStatus;
  createdAt: string;
  paidAt: string | null;
  stripePaymentIntentId: string | null;
  stripeUrl: string | null;
  notifications: { customer: CardNotificationInfo; team: CardNotificationInfo };
}

export interface CardPaymentsListResult {
  total: number;
  page: number;
  pageSize: number;
  currency: string;
  summary: { paidAmount: number; paidCount: number; abandonedCount: number; truncated: boolean };
  payments: CardPaymentListItem[];
}

// Totals are computed in memory over the period: /card volumes are small.
const TOTALS_CAP = 5000;

/**
 * One page of Admin → Paiements carte plus the period totals. Shared by the
 * Server Component page and GET /api/admin/card-payments; callers check
 * orders.view first. Throws when the list cannot be read.
 */
export async function loadCardPaymentsList(
  supabase: SupabaseClient,
  tenant: { id: string; currency?: string | null },
  state: CardPaymentsListState,
  now = new Date(),
): Promise<CardPaymentsListResult> {
  const bounds = periodBounds(state.period, { from: state.from || null, to: state.to || null }, now);
  const since = bounds.since?.toISOString() ?? null;
  const until = bounds.until?.toISOString() ?? null;

  let list = supabase
    .from('tenant_card_payments')
    .select('id, amount, currency, customer_name, customer_email, stripe_payment_intent_id, status, created_at, paid_at', { count: 'exact' })
    .eq('tenant_id', tenant.id);

  const range = referenceRange(state.q);
  if (range) {
    // A reference is searched across all dates.
    list = list.gte('id', range.from).lte('id', range.to);
  } else {
    if (since) list = list.gte('created_at', since);
    if (until) list = list.lt('created_at', until);
    const text = sanitizeSearch(state.q);
    if (text.length >= 2) list = list.or(`customer_name.ilike.%${text}%,customer_email.ilike.%${text}%`);
  }
  if (state.status === 'paid') list = list.eq('status', 'paid');
  if (state.status === 'unfinished') list = list.eq('status', 'pending');

  const from = (state.page - 1) * CARD_PAYMENTS_PAGE_SIZE;
  let totalsQuery = supabase.from('tenant_card_payments').select('amount, status, created_at').eq('tenant_id', tenant.id).limit(TOTALS_CAP + 1);
  if (since) totalsQuery = totalsQuery.gte('created_at', since);
  if (until) totalsQuery = totalsQuery.lt('created_at', until);

  const [{ data, count, error }, totals] = await Promise.all([
    list.order('created_at', { ascending: false }).range(from, from + CARD_PAYMENTS_PAGE_SIZE - 1),
    totalsQuery,
  ]);
  if (error || totals.error) throw error ?? totals.error;

  const allPeriodRows = (totals.data ?? []) as Array<Pick<CardPaymentRow, 'amount' | 'status' | 'created_at'>>;
  const periodRows = allPeriodRows.slice(0, TOTALS_CAP);
  const rows = (data ?? []) as CardPaymentRow[];

  // Automatic confirmation / team alert status, one batch for the page (ledger only, no provider call).
  const keys = rows.flatMap((row) => row.stripe_payment_intent_id ? Object.values(cardPaymentDeliveryKeys(row.stripe_payment_intent_id)) : []);
  const deliveries = new Map<string, { status: string; accepted_at: string | null }>();
  if (keys.length > 0) {
    const { data: deliveryRows, error: deliveryError } = await supabase.from('notification_deliveries')
      .select('idempotency_key, status, accepted_at').eq('tenant_id', tenant.id).in('idempotency_key', keys);
    if (deliveryError) console.error('[admin/card-payments] deliveries unavailable:', deliveryError);
    for (const delivery of (deliveryRows ?? []) as Array<{ idempotency_key: string; status: string; accepted_at: string | null }>) {
      deliveries.set(delivery.idempotency_key, delivery);
    }
  }
  const notificationsFor = (row: CardPaymentRow) => {
    const keysFor = row.stripe_payment_intent_id ? cardPaymentDeliveryKeys(row.stripe_payment_intent_id) : null;
    const customer = keysFor ? deliveries.get(keysFor.customer) : undefined;
    const team = keysFor ? deliveries.get(keysFor.team) : undefined;
    const paid = row.status === 'paid' && Boolean(keysFor);
    return {
      customer: { state: cardNotificationState(customer, { paid, hasRecipient: Boolean(row.customer_email) }), acceptedAt: customer?.accepted_at ?? null },
      team: { state: cardNotificationState(team, { paid, hasRecipient: true }), acceptedAt: team?.accepted_at ?? null },
    };
  };
  const paidRows = periodRows.filter((row) => row.status === 'paid');

  return {
    page: state.page,
    pageSize: CARD_PAYMENTS_PAGE_SIZE,
    total: count ?? 0,
    currency: tenant.currency ?? 'EUR',
    summary: {
      paidAmount: Math.round(paidRows.reduce((sum, row) => sum + Number(row.amount), 0) * 100) / 100,
      paidCount: paidRows.length,
      abandonedCount: periodRows.filter((row) => displayStatus(row, now) === 'abandoned').length,
      /** More than TOTALS_CAP payments in the period: totals cover the first TOTALS_CAP only. */
      truncated: allPeriodRows.length > TOTALS_CAP,
    },
    payments: rows.map((row) => ({
      id: row.id,
      reference: cardPaymentReference(row.id),
      amount: Number(row.amount),
      currency: row.currency,
      customerName: row.customer_name,
      customerEmail: row.customer_email,
      status: displayStatus(row, now),
      createdAt: row.created_at,
      paidAt: row.paid_at,
      stripePaymentIntentId: row.stripe_payment_intent_id,
      stripeUrl: stripeDashboardUrl(row.stripe_payment_intent_id),
      notifications: notificationsFor(row),
    })),
  };
}
