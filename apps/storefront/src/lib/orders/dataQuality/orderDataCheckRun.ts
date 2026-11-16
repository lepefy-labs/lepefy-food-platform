import type { SupabaseClient } from '@supabase/supabase-js';
import { managedShippingProviderInfo } from '@/lib/shipping/providers/registry';
import { notifyOrderDataIssue } from '@/lib/notifications/staff/orderEvents';
import type { DispatchResult } from '@/lib/notifications/staff/dispatcher';
import {
  orderDataIssueOccurrence, orderDataIssues, orderDataIssueSteps, type OrderDataFacts,
} from './orderDataIssues';

/**
 * Hourly data check of every tenant (POST /api/internal/order-data-checks):
 * open, paid, non-test delivery orders of the last LOOKBACK_DAYS whose label
 * is not bought yet. Each faulty order goes to notifyOrderDataIssue; the
 * dispatcher keeps one alert per (order, faulty address version), so the
 * hourly repetition never re-sends. Reads only; never writes an order.
 */
export const LOOKBACK_DAYS = 30;
export const MAX_ORDERS_PER_RUN = 500;

const COLUMNS = 'id, tenant_id, status, fulfillment_type, tracking_code, shipping_address, shipping_provider_reference, shipping_provider_key';

type CheckedOrder = OrderDataFacts & {
  id: string;
  tenant_id: string;
  shipping_provider_reference: string | null;
  shipping_provider_key: string | null;
};

export interface OrderDataCheckSummary {
  scanned: number;
  withIssues: number;
  /** New alerts queued by this run (0 when every faulty order was already reported). */
  notified: number;
  alreadyNotified: number;
  /** Faulty orders of a tenant without any « Commande à vérifier » e-mail recipient (admin shows them anyway). */
  noRecipient: number;
  failed: number;
}

export type NotifyDataIssue = typeof notifyOrderDataIssue;

export async function runOrderDataChecks(db: SupabaseClient, notify: NotifyDataIssue = notifyOrderDataIssue, now = new Date()): Promise<OrderDataCheckSummary> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await db.from('orders').select(COLUMNS)
    .in('status', ['new', 'preparing']).eq('fulfillment_type', 'delivery').eq('payment_status', 'paid')
    .eq('is_test', false).is('tracking_code', null).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(MAX_ORDERS_PER_RUN);
  if (error) throw new Error('order_data_checks_unavailable');

  const orders = (data ?? []) as unknown as CheckedOrder[];
  const summary: OrderDataCheckSummary = { scanned: orders.length, withIssues: 0, notified: 0, alreadyNotified: 0, noRecipient: 0, failed: 0 };
  for (const order of orders) {
    const issues = orderDataIssues(order);
    if (issues.length === 0) continue;
    summary.withIssues++;
    const provider = order.shipping_provider_reference ? managedShippingProviderInfo(order.shipping_provider_key ?? 'packlink')?.displayName ?? null : null;
    const result: DispatchResult | null = await notify(
      order.tenant_id, order.id,
      issues.map((issue) => issue.description),
      orderDataIssueSteps(issues, provider),
      orderDataIssueOccurrence(order, issues),
    );
    if (!result) summary.failed++;
    else if (result.queued > 0) summary.notified++;
    else if (result.alreadyQueued > 0) summary.alreadyNotified++;
    else summary.noRecipient++;
  }
  return summary;
}
