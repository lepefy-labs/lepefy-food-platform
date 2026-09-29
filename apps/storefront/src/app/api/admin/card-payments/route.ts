import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { cardPaymentReference } from '@/lib/card/cardPaymentOutcome';
import {
  CARD_PAYMENTS_PAGE_SIZE, displayStatus, parseDay, parsePage, parsePeriod, parseStatusFilter, periodBounds, referenceRange, sanitizeSearch, stripeDashboardUrl,
} from '@/lib/card/cardPaymentsAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

// Admin → Paiements carte (orders.view, see adminApiPermissions). Read only.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

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

// Totals are computed in memory over the period: /card volumes are small.
const TOTALS_CAP = 5000;

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const authError = await requireAdmin(tenant.id);
  if (authError) return authError;

  const params = req.nextUrl.searchParams;
  const period = parsePeriod(params.get('period'));
  const statusFilter = parseStatusFilter(params.get('status'));
  const page = parsePage(params.get('page'));
  const query = params.get('q') ?? '';
  const now = new Date();
  const fromDay = period === 'custom' ? parseDay(params.get('from')) : null;
  const toDay = period === 'custom' ? parseDay(params.get('to')) : null;
  const bounds = periodBounds(period, { from: fromDay, to: toDay }, now);
  const since = bounds.since?.toISOString() ?? null;
  const until = bounds.until?.toISOString() ?? null;
  const supabase = createServiceClient();

  let list = supabase
    .from('tenant_card_payments')
    .select('id, amount, currency, customer_name, customer_email, stripe_payment_intent_id, status, created_at, paid_at', { count: 'exact' })
    .eq('tenant_id', tenant.id);

  const range = referenceRange(query);
  if (range) {
    // A reference is searched across all dates.
    list = list.gte('id', range.from).lte('id', range.to);
  } else {
    if (since) list = list.gte('created_at', since);
    if (until) list = list.lt('created_at', until);
    const text = sanitizeSearch(query);
    if (text.length >= 2) list = list.or(`customer_name.ilike.%${text}%,customer_email.ilike.%${text}%`);
  }
  if (statusFilter === 'paid') list = list.eq('status', 'paid');
  if (statusFilter === 'unfinished') list = list.eq('status', 'pending');

  const from = (page - 1) * CARD_PAYMENTS_PAGE_SIZE;
  let totalsQuery = supabase.from('tenant_card_payments').select('amount, status, created_at').eq('tenant_id', tenant.id).limit(TOTALS_CAP);
  if (since) totalsQuery = totalsQuery.gte('created_at', since);
  if (until) totalsQuery = totalsQuery.lt('created_at', until);

  const [{ data, count, error }, totals] = await Promise.all([
    list.order('created_at', { ascending: false }).range(from, from + CARD_PAYMENTS_PAGE_SIZE - 1),
    totalsQuery,
  ]);
  if (error || totals.error) {
    console.error('[admin/card-payments] query failed:', error ?? totals.error);
    return NextResponse.json({ error: 'Impossible de charger les paiements.' }, { status: 500 });
  }

  const periodRows = (totals.data ?? []) as Array<Pick<CardPaymentRow, 'amount' | 'status' | 'created_at'>>;
  const paidRows = periodRows.filter((row) => row.status === 'paid');

  return NextResponse.json({
    period,
    from: fromDay,
    to: toDay,
    status: statusFilter,
    page,
    pageSize: CARD_PAYMENTS_PAGE_SIZE,
    total: count ?? 0,
    currency: tenant.currency ?? 'EUR',
    summary: {
      paidAmount: Math.round(paidRows.reduce((sum, row) => sum + Number(row.amount), 0) * 100) / 100,
      paidCount: paidRows.length,
      abandonedCount: periodRows.filter((row) => displayStatus(row, now) === 'abandoned').length,
    },
    payments: ((data ?? []) as CardPaymentRow[]).map((row) => ({
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
    })),
  });
}
