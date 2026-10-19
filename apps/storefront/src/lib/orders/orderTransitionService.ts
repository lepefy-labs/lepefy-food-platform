import type { Order, OrderStatus } from '@lepefy/types';
import type { createServiceClient } from '@/lib/supabase/server';
import { runOrderTransitionSideEffects, validateOrderTransition } from './adminOrderWorkflow';
import { requestShipmentDraft } from '@/lib/shipping/shipmentDraft/shipmentDraftService';
import { preparationBlockers, preparationState, type OrderPreparationMode, type PreparationState } from './preparation/preparationPolicy';
import { readOrderPreparationSettings, toPreparationMode } from './preparation/settings';

export type OrderService = ReturnType<typeof createServiceClient>;
export class OrderWorkflowError extends Error {
  constructor(message: string, public readonly httpStatus = 409) { super(message); }
}
/** Picking/cold-chain/packing not recorded: an operator action, not a technical failure. */
export class PreparationIncompleteError extends OrderWorkflowError {}

export interface PickingItemRow {
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  picked_at: string | null;
  cold_chain_checked_at: string | null;
}

export async function loadWorkflowOrder(service: OrderService, tenantId: string, orderId: string): Promise<Order> {
  const { data, error } = await service.from('orders').select('*').eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw new OrderWorkflowError('Impossible de charger la commande.', 503);
  if (!data) throw new OrderWorkflowError('Commande introuvable.', 404);
  return data as Order;
}

/**
 * Preparation side of preparing → shipped / ready_for_pickup, for every mode
 * (lib/orders/preparation/preparationPolicy.ts). Returns the state so the
 * caller can stamp a transition made without any recorded check.
 */
export async function assertPreparationComplete(service: OrderService, order: Order, packing: boolean): Promise<PreparationState> {
  const { data, error } = await service.from('order_items').select('storage_type, picked_at, cold_chain_checked_at')
    .eq('order_id', order.id).eq('tenant_id', order.tenant_id);
  if (error) throw new OrderWorkflowError('Impossible de vérifier la préparation.', 503);
  const items = (data ?? []) as PickingItemRow[];
  const blockers = preparationBlockers(order, items, packing);
  if (blockers.length > 0) throw new PreparationIncompleteError(blockers.join(' '));
  return preparationState(order, items);
}

/** Tenant mode to snapshot when preparation starts; null when migration 160 is absent. */
export async function tenantPreparationSnapshot(service: OrderService, tenantId: string): Promise<OrderPreparationMode | null> {
  const settings = await readOrderPreparationSettings(service as never, tenantId);
  return settings.available ? toPreparationMode(settings.config) : null;
}

/** Both manual and provider transitions converge here. Only the CAS winner runs side effects.
 * Notifications remain best-effort, as before: we never retry a completed transition/email.
 */
export async function updateWorkflowOrder({ service, order, nextStatus, patch = {}, source = 'admin', shippedAt,
  sideEffects = runOrderTransitionSideEffects,
  onPreparationStarted = (db, tenantId, orderId) => requestShipmentDraft(db, tenantId, orderId, 'preparation_started'),
  resolvePreparationMode = tenantPreparationSnapshot,
}: {
  service: OrderService;
  order: Order;
  nextStatus?: OrderStatus;
  patch?: Record<string, unknown>;
  source?: 'admin' | 'provider' | 'manual_fallback';
  shippedAt?: string | null;
  sideEffects?: typeof runOrderTransitionSideEffects;
  /** Provider-neutral shipment-draft queue (trigger « preparing »); never throws. */
  onPreparationStarted?: (service: OrderService, tenantId: string, orderId: string) => Promise<unknown>;
  /** Mode snapshotted on new → preparing (default: tenant setting, null = no snapshot). */
  resolvePreparationMode?: (service: OrderService, tenantId: string) => Promise<OrderPreparationMode | null>;
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
  let preparation: PreparationState | null = null;
  if (order.status === 'preparing' && (next === 'shipped' || next === 'ready_for_pickup' || catchupDelivered)) {
    preparation = await assertPreparationComplete(service, order, next !== 'ready_for_pickup');
  }
  const update = { ...patch };
  if (nextStatus !== undefined) update.status = next;
  if (order.status === 'new' && next === 'preparing' && !order.picking_started_at) update.picking_started_at = new Date().toISOString();
  // Mode snapshot: decided once, when preparation starts; later setting changes never touch this order.
  if (order.status === 'new' && next === 'preparing' && !order.preparation_mode && update.preparation_mode === undefined) {
    const mode = await resolvePreparationMode(service, order.tenant_id).catch(() => null);
    if (mode) update.preparation_mode = mode;
  }
  // « Sans confirmation »: the final transition is the only declaration — stamped, never a check.
  if (preparation?.unverified && !order.preparation_unverified_at) update.preparation_unverified_at = new Date().toISOString();
  if ((next === 'shipped' || catchupDelivered) && !order.shipped_at) update.shipped_at = shippedAt ?? new Date().toISOString();
  if (Object.keys(update).length === 0) return order;
  const { data, error } = await service.from('orders').update(update)
    .eq('id', order.id).eq('tenant_id', order.tenant_id).eq('status', order.status).eq('updated_at', order.updated_at)
    .select('*').maybeSingle();
  if (error) throw new OrderWorkflowError('Impossible de mettre à jour la commande.', 503);
  if (!data) throw new OrderWorkflowError('La commande a été modifiée. Actualisez et réessayez.');
  const saved = data as Order;
  // Début de la préparation = première écriture de picking_started_at (new → preparing) ;
  // l'autre point d'entrée est la première ligne prélevée (api/admin/orders/[id]/picking).
  if (update.picking_started_at && order.fulfillment_type === 'delivery') {
    await onPreparationStarted(service, order.tenant_id, order.id);
  }
  if (next !== order.status) {
    await sideEffects({ tenantId: order.tenant_id, orderId: order.id, previousStatus: order.status, nextStatus: next,
      email: order.email, fullName: order.full_name, fulfillmentType: order.fulfillment_type,
      trackingCode: saved.tracking_code, trackingCarrier: saved.tracking_carrier,
      shippingEstimatedDeliveryAt: saved.shipping_estimated_delivery_at ?? null });
  }
  return saved;
}
