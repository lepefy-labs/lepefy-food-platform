import { managedShippingProviderKeys } from './providers/registry';
import { syncOrderShipment } from './syncOrderShipment';
import type { OrderService } from '@/lib/orders/orderTransitionService';

export async function runShippingSyncBatch(service: OrderService, sync = syncOrderShipment) {
  const { data, error } = await service.from('orders').select('id, tenant_id')
    .eq('shipping_tracking_mode', 'managed').not('shipping_provider_reference', 'is', null)
    .in('shipping_provider_key', managedShippingProviderKeys()).in('status', ['preparing', 'shipped'])
    .or('shipping_normalized_status.is.null,shipping_normalized_status.not.in.(delivered,returned,cancelled)')
    .order('shipping_provider_synced_at', { ascending: true, nullsFirst: true }).order('id').limit(6);
  if (error) throw new Error('shipping_sync_schema_unavailable');
  const orders = (data ?? []) as { id: string; tenant_id: string }[];
  let succeeded = 0;
  let failed = 0;
  // Two bounded workers; at most three 10s resolves each leave room for canonical side effects.
  let index = 0;
  async function worker() {
    while (index < orders.length) {
      const order = orders[index++];
      if (!order) break;
      try { await sync(service, order.tenant_id, order.id); succeeded++; }
      catch { failed++; console.error('[shipping-sync] order sync failed — order_id:', order.id); }
    }
  }
  await Promise.all([worker(), worker()]);
  return { processed: orders.length, succeeded, failed };
}
