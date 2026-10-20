import { managedShippingProviderKeys } from './providers/registry';
import { syncOrderShipment } from './syncOrderShipment';
import { ShippingProviderError } from './providers/types';
import { OrderWorkflowError, PreparationIncompleteError, type OrderService } from '@/lib/orders/orderTransitionService';

/**
 * Failures that say "try again later" rather than "something is wrong with
 * this order": an aborted/timed-out request (database or provider), the
 * provider being unavailable, or the database answering 503. They are counted
 * apart from `failed`, so the scheduler only alerts on failures that persist
 * (a lasting outage still fails the whole tick on its first query).
 */
export function isTransientSyncFailure(failure: unknown): boolean {
  if (failure instanceof ShippingProviderError) return failure.code === 'shipping_provider_unavailable';
  if (failure instanceof OrderWorkflowError) return failure.httpStatus === 503;
  const name = failure && typeof failure === 'object' ? (failure as { name?: unknown }).name : undefined;
  return name === 'AbortError' || name === 'TimeoutError';
}

export interface ShippingSyncBatchOptions {
  /** Epoch ms after which no new order is started (the tick must answer before the scheduler times out). */
  startBefore?: number;
  now?: () => number;
}

export async function runShippingSyncBatch(service: OrderService, sync = syncOrderShipment, options: ShippingSyncBatchOptions = {}) {
  const now = options.now ?? Date.now;
  const { data, error } = await service.from('orders').select('id, tenant_id')
    .eq('shipping_tracking_mode', 'managed').not('shipping_provider_reference', 'is', null)
    .in('shipping_provider_key', managedShippingProviderKeys()).in('status', ['preparing', 'shipped'])
    .or('shipping_normalized_status.is.null,shipping_normalized_status.not.in.(delivered,returned,cancelled)')
    .order('shipping_provider_synced_at', { ascending: true, nullsFirst: true }).order('id').limit(6);
  if (error) throw new Error('shipping_sync_schema_unavailable');
  const orders = (data ?? []) as { id: string; tenant_id: string }[];
  let succeeded = 0;
  let failed = 0;
  // Waiting on an operator (preparation not recorded, flagged on the order): not a scheduler failure.
  let blocked = 0;
  // Timeouts / provider or database unavailable: retried by the next tick, not an alert.
  let transient = 0;
  // Not started because the time budget was spent: they stay at the head of the queue.
  let deferred = 0;
  // Two bounded workers; at most three 10s resolves each leave room for canonical side effects.
  let index = 0;
  async function worker() {
    while (index < orders.length) {
      if (options.startBefore !== undefined && now() >= options.startBefore) {
        deferred += orders.length - index;
        index = orders.length;
        break;
      }
      const order = orders[index++];
      if (!order) break;
      try { await sync(service, order.tenant_id, order.id); succeeded++; }
      catch (failure) {
        if (failure instanceof PreparationIncompleteError) { blocked++; console.warn('[shipping-sync] order awaiting preparation — order_id:', order.id); }
        else if (isTransientSyncFailure(failure)) { transient++; console.warn('[shipping-sync] order sync deferred (transient) — order_id:', order.id); }
        else { failed++; console.error('[shipping-sync] order sync failed — order_id:', order.id); }
      }
    }
  }
  await Promise.all([worker(), worker()]);
  return { processed: orders.length, succeeded, failed, blocked, transient, deferred };
}
