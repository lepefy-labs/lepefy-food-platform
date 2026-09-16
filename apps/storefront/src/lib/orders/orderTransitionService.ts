import type { Order, OrderStatus } from '@lepefy/types';
import type { createServiceClient } from '@/lib/supabase/server';
import { runOrderTransitionSideEffects, validateOrderTransition } from './adminOrderWorkflow';

export type OrderService = ReturnType<typeof createServiceClient>;
export class OrderWorkflowError extends Error {
  constructor(message: string, public readonly httpStatus = 409) { super(message); }
}

export interface PickingItemRow {
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  picked_at: string | null;
  cold_chain_checked_at: string | null;
}

export function pickingError(items: PickingItemRow[]): string | null {
  if (items.length === 0) return 'La commande ne contient aucun article à préparer.';
  const unpicked = items.filter(item => !item.picked_at).length;
  const coldUnchecked = items.filter(item =>
    (item.storage_type === 'fresh' || item.storage_type === 'frozen') && !item.cold_chain_checked_at,
  ).length;
  if (unpicked === 0 && coldUnchecked === 0) return null;
  const parts: string[] = [];
  if (unpicked > 0) parts.push(`${unpicked} ligne${unpicked > 1 ? 's' : ''} non prélevée${unpicked > 1 ? 's' : ''}`);
  if (coldUnchecked > 0) parts.push(`${coldUnchecked} contrôle${coldUnchecked > 1 ? 's' : ''} froid manquant${coldUnchecked > 1 ? 's' : ''}`);
  return `Préparation incomplète : ${parts.join(' · ')}.`;
}

export async function loadWorkflowOrder(service: OrderService, tenantId: string, orderId: string): Promise<Order> {
  const { data, error } = await service.from('orders').select('*').eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw new OrderWorkflowError('Impossible de charger la commande.', 503);
  if (!data) throw new OrderWorkflowError('Commande introuvable.', 404);
  return data as Order;
}

export async function assertPreparationComplete(service: OrderService, order: Order, packing: boolean) {
  const { data, error } = await service.from('order_items').select('storage_type, picked_at, cold_chain_checked_at')
    .eq('order_id', order.id).eq('tenant_id', order.tenant_id);
  if (error) throw new OrderWorkflowError('Impossible de vérifier la préparation.', 503);
  const items = (data ?? []) as PickingItemRow[];
  const message = pickingError(items);
  if (message) throw new OrderWorkflowError(message);
  if (packing && (!order.packing_completed_at || !order.packing_parcel_count || order.packing_parcel_count < 1
    || (items.some(item => item.storage_type === 'fresh' || item.storage_type === 'frozen') && !order.cold_chain_packing_checked_at))) {
    throw new OrderWorkflowError('Packing incomplet : validez les colis et les contrôles froid avant l’expédition.');
  }
}

/** Both manual and provider transitions converge here. Only the CAS winner runs side effects.
 * Notifications remain best-effort, as before: we never retry a completed transition/email.
 */
export async function updateWorkflowOrder({ service, order, nextStatus, patch = {}, source = 'admin', shippedAt,
  sideEffects = runOrderTransitionSideEffects,
}: {
  service: OrderService;
  order: Order;
  nextStatus?: OrderStatus;
  patch?: Record<string, unknown>;
  source?: 'admin' | 'provider' | 'manual_fallback';
  shippedAt?: string | null;
  sideEffects?: typeof runOrderTransitionSideEffects;
}): Promise<Order> {
  const next = nextStatus ?? order.status;
  const trackingCode = patch.tracking_code !== undefined ? patch.tracking_code as string | null : order.tracking_code;
  if (source === 'admin' && order.shipping_tracking_mode === 'managed'
    && ((next !== order.status && (next === 'shipped' || next === 'delivered'))
      || patch.tracking_code !== undefined || patch.tracking_carrier !== undefined)) {
    throw new OrderWorkflowError('Le suivi est géré automatiquement. Utilisez explicitement le suivi manuel pour le remplacer.');
  }
  const catchupDelivered = source === 'provider' && order.fulfillment_type === 'delivery'
    && order.status === 'preparing' && next === 'delivered';
  const steps: OrderStatus[] = catchupDelivered ? ['shipped', 'delivered'] : [next];
  let current = order.status;
  for (const step of steps) {
    const validation = validateOrderTransition({ current, next: step, fulfillmentType: order.fulfillment_type, trackingCode });
    if (!validation.ok) throw new OrderWorkflowError(validation.error);
    current = step;
  }
  if (order.status === 'preparing' && (next === 'shipped' || next === 'ready_for_pickup' || catchupDelivered)) {
    await assertPreparationComplete(service, order, next !== 'ready_for_pickup');
  }
  const update = { ...patch };
  if (nextStatus !== undefined) update.status = next;
  if (order.status === 'new' && next === 'preparing' && !order.picking_started_at) update.picking_started_at = new Date().toISOString();
  if ((next === 'shipped' || catchupDelivered) && !order.shipped_at) update.shipped_at = shippedAt ?? new Date().toISOString();
  if (Object.keys(update).length === 0) return order;
  const { data, error } = await service.from('orders').update(update)
    .eq('id', order.id).eq('tenant_id', order.tenant_id).eq('status', order.status).eq('updated_at', order.updated_at)
    .select('*').maybeSingle();
  if (error) throw new OrderWorkflowError('Impossible de mettre à jour la commande.', 503);
  if (!data) throw new OrderWorkflowError('La commande a été modifiée. Actualisez et réessayez.');
  const saved = data as Order;
  if (next !== order.status) {
    await sideEffects({ tenantId: order.tenant_id, orderId: order.id, previousStatus: order.status, nextStatus: next,
      email: order.email, fullName: order.full_name, fulfillmentType: order.fulfillment_type,
      trackingCode: saved.tracking_code, trackingCarrier: saved.tracking_carrier });
  }
  return saved;
}
