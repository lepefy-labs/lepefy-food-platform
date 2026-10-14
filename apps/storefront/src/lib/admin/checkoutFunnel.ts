import { classifyCardCart, type CardCartOutcome, type FunnelEvent } from '@/lib/payments/cardCartOutcome';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Checkout funnel of /admin/checkout-funnel, computed from storefront
 * checkout_sessions over a selectable range (the 30-day SQL view stays for
 * other readers). Pure summary + one bounded loader; test orders excluded.
 */

export type FunnelRange = 7 | 30 | 90;
export const RECOVERY_WINDOW_DAYS = 7;
const PAGE_SIZE = 1000;
const ORDER_CHUNK = 200;

export function parseFunnelRange(value: string | string[] | undefined): FunnelRange {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === '7' || raw === '90' ? Number(raw) as FunnelRange : 30;
}

export type SessionStatus = 'open' | 'awaiting_verification' | 'completed' | 'expired' | 'cancelled' | 'draft' | string;

export interface FunnelSession {
  id: string;
  status: SessionStatus;
  created_at: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  items: unknown;
  shipping_total: number | string | null;
  ambassador_discount_amount: number | string | null;
  resume_count: number | null;
  order_id: string | null;
  /** `stripe` (carte) ou `external_link`. */
  payment_method?: string | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Items × quantity + shipping − ambassador discount (same basis as the pending-payment screens). */
export function sessionValue(session: Pick<FunnelSession, 'items' | 'shipping_total' | 'ambassador_discount_amount'>): number {
  const items = Array.isArray(session.items) ? session.items as Array<{ price?: unknown; quantity?: unknown }> : [];
  const goods = items.reduce((sum, item) => {
    const price = Number(item?.price), quantity = Number(item?.quantity);
    return Number.isFinite(price) && Number.isFinite(quantity) ? sum + price * quantity : sum;
  }, 0);
  const total = goods + Number(session.shipping_total ?? 0) - Number(session.ambassador_discount_amount ?? 0);
  return round2(Math.max(0, total));
}

export interface FunnelSummary {
  started: number;
  completed: number;
  inProgress: number;
  open: number;
  awaitingVerification: number;
  expired: number;
  cancelled: number;
  /** completed / (completed + expired + cancelled): sessions still running are not counted as lost. */
  conversionRate: number | null;
  resumed: number;
  recovered: number;
  value: { converted: number; pending: number; lost: number };
}

export function summarizeFunnel(sessions: FunnelSession[]): FunnelSummary {
  const by = (status: string) => sessions.filter((session) => session.status === status);
  const sum = (rows: FunnelSession[]) => round2(rows.reduce((total, row) => total + sessionValue(row), 0));
  const completed = by('completed'), open = by('open'), awaiting = by('awaiting_verification');
  const expired = by('expired'), cancelled = by('cancelled');
  const decided = completed.length + expired.length + cancelled.length;
  const resumed = sessions.filter((session) => (session.resume_count ?? 0) > 0);
  return {
    started: sessions.length,
    completed: completed.length,
    inProgress: open.length + awaiting.length,
    open: open.length,
    awaitingVerification: awaiting.length,
    expired: expired.length,
    cancelled: cancelled.length,
    conversionRate: decided > 0 ? Math.round((completed.length / decided) * 1000) / 10 : null,
    resumed: resumed.length,
    recovered: resumed.filter((session) => session.status === 'completed').length,
    value: { converted: sum(completed), pending: sum([...open, ...awaiting]), lost: sum([...expired, ...cancelled]) },
  };
}

export interface RecoverableCart {
  id: string;
  status: 'open' | 'expired';
  paymentMethod: string | null;
  customer: string;
  value: number;
  createdAt: string;
}

/** Open or expired carts of the last days that can still be followed up, highest value first. */
export function recoverableCarts(sessions: FunnelSession[], now: Date = new Date(), limit = 10): RecoverableCart[] {
  const since = now.getTime() - RECOVERY_WINDOW_DAYS * 86_400_000;
  return sessions
    .filter((session) => (session.status === 'open' || session.status === 'expired')
      && Date.parse(session.created_at) >= since && Boolean(session.email || session.phone))
    .map((session) => ({
      id: session.id,
      status: session.status as 'open' | 'expired',
      paymentMethod: session.payment_method ?? null,
      customer: session.full_name?.trim() || session.email || session.phone || 'Client',
      value: sessionValue(session),
      createdAt: session.created_at,
    }))
    .sort((a, b) => b.value - a.value || b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/**
 * Résultat de paiement des paniers carte à relancer, d'après leur journal
 * (`classifyCardCart`). Lecture bornée aux ids reçus, toujours sur le tenant ;
 * en cas d'erreur, aucun libellé (la liste reste affichée).
 */
export async function loadCardCartOutcomes(supabase: SupabaseClient, tenantId: string, sessionIds: string[]): Promise<Map<string, CardCartOutcome>> {
  const outcomes = new Map<string, CardCartOutcome>();
  if (sessionIds.length === 0) return outcomes;
  const { data, error } = await supabase
    .from('payment_funnel_logs')
    .select('reference_id, event_type, created_at')
    .eq('tenant_id', tenantId)
    .eq('module', 'shop')
    .in('reference_id', sessionIds)
    .limit(2000);
  if (error) return outcomes;
  const byId = new Map<string, FunnelEvent[]>();
  for (const row of (data ?? []) as Array<FunnelEvent & { reference_id: string }>) {
    byId.set(row.reference_id, [...(byId.get(row.reference_id) ?? []), row]);
  }
  for (const id of sessionIds) outcomes.set(id, classifyCardCart(byId.get(id) ?? []));
  return outcomes;
}

export async function loadFunnelSessions(supabase: SupabaseClient, tenantId: string, rangeDays: FunnelRange, now: Date = new Date()): Promise<FunnelSession[]> {
  const since = new Date(now.getTime() - rangeDays * 86_400_000).toISOString();
  const rows: FunnelSession[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('checkout_sessions')
      .select('id, status, created_at, email, full_name, phone, items, shipping_total, ambassador_discount_amount, resume_count, order_id, payment_method')
      .eq('tenant_id', tenantId)
      .eq('origin', 'storefront')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Unable to load checkout sessions: ${error.message}`);
    const page = (data ?? []) as FunnelSession[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  // E2E/test orders (orders.is_test) never count as conversions.
  const orderIds = [...new Set(rows.flatMap((row) => (row.order_id ? [row.order_id] : [])))];
  const testOrders = new Set<string>();
  for (let index = 0; index < orderIds.length; index += ORDER_CHUNK) {
    const { data, error } = await supabase
      .from('orders')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('is_test', true)
      .in('id', orderIds.slice(index, index + ORDER_CHUNK));
    if (error) throw new Error(`Unable to load test orders: ${error.message}`);
    for (const row of data ?? []) testOrders.add(row.id as string);
  }
  return rows.filter((row) => !(row.order_id && testOrders.has(row.order_id)));
}
