import type { NormalizedShipmentStatus, OrderStatus, ShipmentTrackingEvent } from '@lepefy/types';
import { shipmentEventsNewestFirst } from '@/lib/shipping/shipmentPresentation';

export interface OperationalOrder {
  status: OrderStatus;
  fulfillment_type: 'delivery' | 'pickup';
  payment_status: string;
  created_at: string;
  updated_at: string;
  picking_started_at?: string | null;
  picking_completed_at?: string | null;
  packing_completed_at?: string | null;
  shipping_tracking_mode?: 'managed' | 'manual' | null;
  managedProviderAvailable?: boolean;
  shipping_provider_reference?: string | null;
  shipping_normalized_status?: NormalizedShipmentStatus | null;
  shipping_sync_error?: string | null;
  shipping_tracking_events?: ShipmentTrackingEvent[] | null;
  shipping_estimated_delivery_at?: string | null;
  tracking_code?: string | null;
}

export interface OperationalThresholds { prepareHours: number; pickupHours: number; trackingStaleHours: number }
export type QueueKey = 'to_treat' | 'preparing' | 'to_ship' | 'in_transit' | 'incidents' | 'pickup_ready' | 'urgent' | 'finished';

const INCIDENT_STATUSES = new Set<NormalizedShipmentStatus>(['exception', 'returned', 'cancelled']);
const ACTIVE_DELIVERY_STATUSES = new Set<OrderStatus>(['new', 'preparing', 'shipped']);

function hoursSince(date: string | null | undefined, now: Date): number | null {
  const time = Date.parse(date ?? '');
  return Number.isFinite(time) ? Math.max(0, (now.getTime() - time) / 3_600_000) : null;
}

export function lastTrackingEventAt(order: OperationalOrder): string | null {
  return shipmentEventsNewestFirst(order.shipping_tracking_events)[0]?.occurredAt ?? null;
}

export function hasLogisticsIncident(order: OperationalOrder): boolean {
  return order.fulfillment_type === 'delivery' && ACTIVE_DELIVERY_STATUSES.has(order.status)
    && (Boolean(order.shipping_sync_error) || Boolean(order.shipping_normalized_status && INCIDENT_STATUSES.has(order.shipping_normalized_status)));
}

export function isTrackingStale(order: OperationalOrder, thresholds: OperationalThresholds, now: Date): boolean {
  if (order.status !== 'shipped' || order.fulfillment_type !== 'delivery' || !order.shipping_provider_reference
    || !['in_transit', 'out_for_delivery'].includes(order.shipping_normalized_status ?? '')) return false;
  const age = hoursSince(lastTrackingEventAt(order), now);
  return age !== null && age >= thresholds.trackingStaleHours;
}

export function orderQueueFlags(order: OperationalOrder, thresholds: OperationalThresholds, now: Date): Set<QueueKey> {
  const flags = new Set<QueueKey>();
  if (order.status === 'delivered' || order.status === 'cancelled') { flags.add('finished'); return flags; }
  const incident = hasLogisticsIncident(order);
  if (incident) flags.add('incidents');
  if (['new', 'preparing', 'ready_for_pickup', 'stock_conflict'].includes(order.status) || incident) flags.add('to_treat');
  if (order.status === 'preparing') flags.add('preparing');
  if (order.status === 'preparing' && order.fulfillment_type === 'delivery' && order.picking_completed_at && order.packing_completed_at) flags.add('to_ship');
  if (order.status === 'shipped' && order.fulfillment_type === 'delivery' && ['in_transit', 'out_for_delivery'].includes(order.shipping_normalized_status ?? '')) flags.add('in_transit');
  if (order.status === 'ready_for_pickup' && order.fulfillment_type === 'pickup') flags.add('pickup_ready');
  const preparationAge = hoursSince(order.status === 'preparing' ? order.picking_started_at ?? order.created_at : order.created_at, now);
  const pickupAge = hoursSince(order.updated_at, now); // last activity, not a verified transition timestamp
  const etaOverdue = order.status === 'shipped' && order.fulfillment_type === 'delivery'
    && order.shipping_provider_reference && order.shipping_estimated_delivery_at
    && ['in_transit', 'out_for_delivery', 'ready_for_collection'].includes(order.shipping_normalized_status ?? '')
    && Date.parse(order.shipping_estimated_delivery_at) < now.getTime();
  if (order.status === 'stock_conflict' || incident || order.payment_status !== 'paid'
    || (['new', 'preparing'].includes(order.status) && preparationAge !== null && preparationAge >= thresholds.prepareHours)
    || (order.status === 'ready_for_pickup' && pickupAge !== null && pickupAge >= thresholds.pickupHours)
    || isTrackingStale(order, thresholds, now) || etaOverdue) flags.add('urgent');
  return flags;
}

export interface NextOrderAction { label: string; primary: boolean; intent: 'detail' | 'tracking' | 'incident' }

export function nextOrderAction(order: OperationalOrder): NextOrderAction {
  const action = (label: string, intent: NextOrderAction['intent'] = 'detail', primary = true): NextOrderAction => ({ label, intent, primary });
  if (order.status === 'delivered' || order.status === 'cancelled') return action('Voir', 'detail', false);
  if (order.status === 'stock_conflict') return action('Vérifier le conflit');
  if (hasLogisticsIncident(order)) return action('Résoudre l’incident', 'incident');
  if (order.payment_status !== 'paid') return action('Vérifier le paiement');
  if (order.status === 'new') return action('Préparer');
  if (order.status === 'preparing') {
    if (!order.picking_completed_at) return action('Continuer le picking');
    if (order.fulfillment_type === 'pickup') return action('Marquer prête au retrait');
    if (!order.packing_completed_at) return action('Terminer le packing');
    if (order.shipping_tracking_mode !== 'manual' && (order.shipping_tracking_mode === 'managed' || order.managedProviderAvailable))
      return action(order.shipping_provider_reference ? 'Gérer l’expédition' : 'Associer l’expédition');
    return action('Expédier');
  }
  if (order.status === 'ready_for_pickup') return action('Marquer retirée');
  if (order.status === 'shipped') return order.tracking_code
    ? action('Voir le suivi', 'tracking', false) : action('Vérifier l’expédition');
  return action('Voir', 'detail', false);
}

export function urgencyLabel(order: OperationalOrder, thresholds: OperationalThresholds, now: Date): string | null {
  if (isTrackingStale(order, thresholds, now)) {
    const age = hoursSince(lastTrackingEventAt(order), now);
    return age === null ? null : `Suivi sans mouvement depuis ${Math.floor(age)} h`;
  }
  if (order.status === 'ready_for_pickup') {
    const age = hoursSince(order.updated_at, now);
    return age !== null && age >= thresholds.pickupHours ? `Dernière activité il y a ${Math.floor(age)} h` : null;
  }
  if (order.status === 'new' || order.status === 'preparing') {
    const age = hoursSince(order.status === 'preparing' ? order.picking_started_at ?? order.created_at : order.created_at, now);
    if (age !== null && age >= thresholds.prepareHours) return `${order.status === 'new' ? 'Ouverte' : 'En préparation'} depuis ${Math.floor(age)} h`;
  }
  return null;
}
