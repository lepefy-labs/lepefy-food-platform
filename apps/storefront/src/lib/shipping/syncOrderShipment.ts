import type { Order, OrderStatus } from '@lepefy/types';
import { assertPreparationComplete, loadWorkflowOrder, OrderWorkflowError, updateWorkflowOrder, type OrderService } from '@/lib/orders/orderTransitionService';
import { getShippingProvider } from './providers/registry';
import { ShippingProviderError, type ProviderShipmentSnapshot, type ShippingProviderAdapter } from './providers/types';

export function shipmentOrderTarget(current: OrderStatus, snapshot: ProviderShipmentSnapshot): OrderStatus {
  if (snapshot.normalizedStatus === 'delivered' && (current === 'preparing' || current === 'shipped')) return 'delivered';
  if (['in_transit', 'out_for_delivery'].includes(snapshot.normalizedStatus) && current === 'preparing') return 'shipped';
  // Exceptions, returned/cancelled shipments do not invent order cancellation/refund transitions.
  return current;
}

export function shipmentSnapshotPatch(snapshot: ProviderShipmentSnapshot, syncedAt = new Date().toISOString()): Record<string, unknown> {
  return {
    shipping_tracking_mode: 'managed', shipping_provider_key: snapshot.provider,
    shipping_provider_reference: snapshot.providerReference, shipping_provider_status: snapshot.providerStatus,
    shipping_normalized_status: snapshot.normalizedStatus, shipping_provider_synced_at: syncedAt,
    shipping_tracking_url: snapshot.trackingUrl, shipping_estimated_delivery_at: snapshot.estimatedDeliveryAt,
    shipping_tracking_events: snapshot.events, shipping_sync_error: null,
    tracking_code: snapshot.trackingCode, tracking_carrier: snapshot.carrier,
  };
}

export async function applyShipmentSnapshot(service: OrderService, order: Order, snapshot: ProviderShipmentSnapshot,
  sideEffects?: Parameters<typeof updateWorkflowOrder>[0]['sideEffects']) {
  if (order.fulfillment_type !== 'delivery' || order.status === 'cancelled') throw new OrderWorkflowError('Cette commande ne peut pas utiliser le suivi automatique.');
  const next = shipmentOrderTarget(order.status, snapshot);
  const firstTransit = snapshot.events.find(event => event.status === 'in_transit' || event.status === 'out_for_delivery');
  return updateWorkflowOrder({ service, order, nextStatus: next, patch: shipmentSnapshotPatch(snapshot), source: 'provider',
    shippedAt: firstTransit?.occurredAt, sideEffects });
}

/** Tenant is always resolved from the scoped order, never a deployment-default tenant. */
export async function syncOrderShipment(service: OrderService, tenantId: string, orderId: string,
  attachReference?: string, adapterLookup: (key: string | null | undefined) => ShippingProviderAdapter | null = getShippingProvider): Promise<Order> {
  const order = await loadWorkflowOrder(service, tenantId, orderId);
  if (order.fulfillment_type !== 'delivery' || !['preparing', 'shipped'].includes(order.status)) {
    throw new OrderWorkflowError('Cette commande ne peut pas être synchronisée.');
  }
  // Explicit schema preflight: migration must exist before any provider reference can be attached.
  const schema = await service.from('orders').select('shipping_provider_key, shipping_provider_reference, shipping_provider_synced_at')
    .eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
  if (schema.error) throw new OrderWorkflowError('Le suivi automatique nécessite la migration shipping 111.', 503);
  const { data: tenant, error } = await service.from('tenants').select('*')
    .eq('id', order.tenant_id).maybeSingle();
  if (error || !tenant) throw new OrderWorkflowError('Configuration transport indisponible.', 503);
  const attaching = attachReference !== undefined;
  if (attaching && order.shipping_provider_reference) {
    throw new OrderWorkflowError('Une expédition est déjà associée. Passez explicitement au suivi manuel avant de la remplacer.');
  }
  if (!attaching && (order.shipping_tracking_mode !== 'managed' || !order.shipping_provider_reference)) {
    throw new OrderWorkflowError('Aucune expédition automatique associée.');
  }
  const key = attaching ? tenant.shipping_provider as string : order.shipping_provider_key;
  const adapter = adapterLookup(key);
  if (!adapter?.capabilities.providerReference) throw new OrderWorkflowError('Ce prestataire utilise le suivi manuel.');
  if (attaching) {
    await assertPreparationComplete(service, order, true);
  }
  try {
    const snapshot = await adapter.resolveShipment({ tenantId: order.tenant_id, tenant },
      attaching ? attachReference : order.shipping_provider_reference!);
    if (snapshot.provider !== adapter.key) throw new ShippingProviderError('shipment_provider_mismatch');
    return await applyShipmentSnapshot(service, order, snapshot);
  } catch (failure) {
    // Invalid initial references must never create an association or mutate an order.
    if (!attaching && failure instanceof ShippingProviderError) {
      await service.from('orders').update({ shipping_provider_synced_at: new Date().toISOString(), shipping_sync_error: failure.code })
        .eq('id', order.id).eq('tenant_id', order.tenant_id).eq('updated_at', order.updated_at)
        .eq('shipping_tracking_mode', 'managed').eq('shipping_provider_reference', order.shipping_provider_reference);
    }
    throw failure;
  }
}
