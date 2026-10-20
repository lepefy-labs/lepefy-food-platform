import type { NormalizedShipmentStatus, OrderStatus, ShipmentTrackingEvent } from '@lepefy/types';
import { SHIPPING_SYNC_PREPARATION_INCOMPLETE, shipmentEventsNewestFirst, shipmentStatusLabel } from '@/lib/shipping/shipmentPresentation';
import {
  DIGITAL_PREPARATION, preparationState, preparationStep,
  type OrderPreparationMode, type PreparationOrder, type PreparationStep,
} from './preparation/preparationPolicy';

// Single operational classifier of the Admin → Commandes work queue. KPIs,
// views, the "Priorité opérationnelle" sort and every row read it: no queue
// rule lives in JSX or SQL elsewhere. Pure and client-safe (persisted
// snapshots only, never a live provider call). The order state machine stays
// in orderTransitionService; nothing here mutates an order.

export interface OperationalOrder extends Omit<PreparationOrder, 'status' | 'order_items'> {
  id?: string;
  status: OrderStatus;
  fulfillment_type: 'delivery' | 'pickup';
  payment_status: string;
  created_at: string;
  updated_at: string;
  total?: number | null;
  shipping_address?: { country?: string | null } | null;
  order_items?: Array<{ storage_type?: string | null; picked_at?: string | null; cold_chain_checked_at?: string | null }> | null;
  originCountry?: string | null;
  /** Tenant's current preparation mode: decides the step of an order not started yet. */
  tenantPreparationMode?: OrderPreparationMode;
  shipped_at?: string | null;
  picking_started_at?: string | null;
  picking_completed_at?: string | null;
  packing_completed_at?: string | null;
  shipping_tracking_mode?: 'managed' | 'manual' | null;
  managedProviderAvailable?: boolean;
  shipping_provider_reference?: string | null;
  shipping_provider_key?: string | null;
  /** Last provisioning transition (migration 151): creation time of a `draft_created` draft. */
  shipping_creation_updated_at?: string | null;
  shipping_normalized_status?: NormalizedShipmentStatus | null;
  shipping_sync_error?: string | null;
  shipping_tracking_events?: ShipmentTrackingEvent[] | null;
  shipping_estimated_delivery_at?: string | null;
  tracking_code?: string | null;
}

export interface OperationalThresholds { prepareHours: number; pickupHours: number; trackingStaleHours: number }
export type QueueKey = 'to_treat' | 'preparing' | 'to_ship' | 'in_transit' | 'incidents' | 'pickup_ready' | 'urgent' | 'finished'
  // Work views of the « Aujourd'hui » dashboard (same classifier, one count per order and view).
  | 'to_prepare' | 'to_print' | 'late_preparation' | 'late_pickup' | 'tracking_issues' | 'payment_unverified' | 'stock_conflict'
  // « Contrôles » chips, aware of each order's preparation mode (never a missing digital click in paper mode).
  | 'picking_incomplete' | 'packing_pending' | 'tracking_missing' | 'cold_chain' | 'paper_in_progress';

export type PriorityGroup =
  | 'action_required' | 'preparation_overdue' | 'pickup_overdue' | 'preparing'
  | 'to_ship' | 'shipping' | 'pickup_ready' | 'finished';

/** Order of the "Priorité opérationnelle" sort, most pressing first. */
export const PRIORITY_GROUP_ORDER: readonly PriorityGroup[] = [
  'action_required', 'preparation_overdue', 'pickup_overdue', 'preparing', 'to_ship', 'shipping', 'pickup_ready', 'finished',
];

export const PRIORITY_GROUP_LABELS: Record<PriorityGroup, string> = {
  action_required: 'Action requise',
  preparation_overdue: 'Préparation en retard',
  pickup_overdue: 'Retrait en retard',
  preparing: 'En préparation',
  to_ship: 'À expédier',
  shipping: 'Expéditions en cours',
  pickup_ready: 'Retraits prêts',
  finished: 'Terminées',
};

const TERMINAL_STATUSES = new Set<OrderStatus>(['delivered', 'cancelled']);
const INCIDENT_STATUSES = new Set<NormalizedShipmentStatus>(['exception', 'returned', 'cancelled']);
const ACTIVE_DELIVERY_STATUSES = new Set<OrderStatus>(['new', 'preparing', 'shipped']);
const MOVING_STATUSES = new Set<NormalizedShipmentStatus>(['in_transit', 'out_for_delivery']);

export function isTerminalOrder(order: Pick<OperationalOrder, 'status'>): boolean {
  return TERMINAL_STATUSES.has(order.status);
}

function hoursSince(date: string | null | undefined, now: Date): number | null {
  const time = Date.parse(date ?? '');
  return Number.isFinite(time) ? Math.max(0, (now.getTime() - time) / 3_600_000) : null;
}

/** Human duration: hours below 48 h, whole days from 48 h on ("26 h", "18 j"). */
export function formatOperationalDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours < 1) return 'moins d’1 h';
  return hours < 48 ? `${Math.floor(hours)} h` : `${Math.floor(hours / 24)} j`;
}

/** "il y a 3 j" for a timestamp, null when unreadable. */
export function formatSince(date: string | null | undefined, now: Date): string | null {
  const hours = hoursSince(date, now);
  return hours === null ? null : `il y a ${formatOperationalDuration(hours)}`;
}

export function lastTrackingEventAt(order: OperationalOrder): string | null {
  return shipmentEventsNewestFirst(order.shipping_tracking_events)[0]?.occurredAt ?? null;
}

/** Provider-confirmed anomaly (carrier status or sync error) on an active delivery. */
export function hasLogisticsIncident(order: OperationalOrder): boolean {
  return order.fulfillment_type === 'delivery' && ACTIVE_DELIVERY_STATUSES.has(order.status)
    && (Boolean(order.shipping_sync_error) || Boolean(order.shipping_normalized_status && INCIDENT_STATUSES.has(order.shipping_normalized_status)));
}

export function isTrackingStale(order: OperationalOrder, thresholds: OperationalThresholds, now: Date): boolean {
  if (order.status !== 'shipped' || order.fulfillment_type !== 'delivery' || !order.shipping_provider_reference
    || !MOVING_STATUSES.has(order.shipping_normalized_status as NormalizedShipmentStatus)) return false;
  const age = hoursSince(lastTrackingEventAt(order), now);
  return age !== null && age >= thresholds.trackingStaleHours;
}

function isEtaOverdue(order: OperationalOrder, now: Date): boolean {
  return order.status === 'shipped' && order.fulfillment_type === 'delivery'
    && Boolean(order.shipping_provider_reference) && Boolean(order.shipping_estimated_delivery_at)
    && ['in_transit', 'out_for_delivery', 'ready_for_collection'].includes(order.shipping_normalized_status ?? '')
    && Date.parse(order.shipping_estimated_delivery_at!) < now.getTime();
}

/** Preparation and packing satisfied for the order's mode (preparationPolicy). */
function isReadyToShip(order: OperationalOrder): boolean {
  if (order.status !== 'preparing' || order.fulfillment_type !== 'delivery') return false;
  const state = preparationState(order);
  // « Sans confirmation » + Lepefy provider draft: the parcels are at the provider, the order waits for the carrier.
  return state.readyForFinal || state.awaitingProviderParcels;
}

const PROVIDER_NAMES: Record<string, string> = { packlink: 'Packlink' };

/**
 * Draft created by Lepefy and not purchased yet at the provider (still `pending`):
 * the next step happens in the provider's tool (label purchase), not in Lepefy.
 */
export function providerDraftToFinalize(order: Pick<OperationalOrder, 'status' | 'fulfillment_type' | 'shipping_creation_status' | 'shipping_provider_reference' | 'shipping_normalized_status' | 'shipping_sync_error'>): boolean {
  return order.status === 'preparing' && order.fulfillment_type === 'delivery' && order.shipping_creation_status === 'draft_created'
    && Boolean(order.shipping_provider_reference) && !order.shipping_sync_error
    && (!order.shipping_normalized_status || order.shipping_normalized_status === 'pending');
}

/** "Packlink" for a known provider key, null otherwise (callers then say « le transporteur »). */
export function providerDisplayName(key: string | null | undefined): string | null {
  return key ? PROVIDER_NAMES[key.toLowerCase()] ?? null : null;
}

function usesManagedShipment(order: OperationalOrder): boolean {
  return order.shipping_tracking_mode !== 'manual' && (order.shipping_tracking_mode === 'managed' || Boolean(order.managedProviderAvailable));
}

/** Start of the preparation clock: picking start when known, else creation. */
function preparationStartedAt(order: OperationalOrder): string {
  return order.status === 'preparing' ? order.picking_started_at ?? order.created_at : order.created_at;
}

export type OrderAnomalyCode =
  | 'stock_conflict' | 'carrier_incident' | 'parcel_returned' | 'shipment_cancelled' | 'sync_error'
  | 'payment_unverified' | 'shipped_without_tracking' | 'tracking_stale' | 'eta_overdue';

export interface OrderAnomaly { code: OrderAnomalyCode; label: string }

/** Reliable anomalies only: never a warning on a normal state. */
export function orderAnomaly(order: OperationalOrder, thresholds: OperationalThresholds, now: Date): OrderAnomaly | null {
  if (isTerminalOrder(order)) return null;
  if (order.status === 'stock_conflict') return { code: 'stock_conflict', label: 'Conflit de stock' };
  if (hasLogisticsIncident(order)) {
    if (order.shipping_normalized_status === 'exception') return { code: 'carrier_incident', label: 'Incident transporteur' };
    if (order.shipping_normalized_status === 'returned') return { code: 'parcel_returned', label: 'Colis retourné' };
    if (order.shipping_normalized_status === 'cancelled') return { code: 'shipment_cancelled', label: 'Expédition annulée côté transporteur' };
    return { code: 'sync_error', label: 'Synchronisation transporteur en erreur' };
  }
  if (order.payment_status !== 'paid') return { code: 'payment_unverified', label: 'Paiement à vérifier' };
  if (order.status === 'shipped' && order.fulfillment_type === 'delivery' && !order.tracking_code && !order.shipping_provider_reference)
    return { code: 'shipped_without_tracking', label: 'Expédiée sans suivi' };
  if (isTrackingStale(order, thresholds, now)) {
    const age = hoursSince(lastTrackingEventAt(order), now) ?? 0;
    return { code: 'tracking_stale', label: `Suivi sans mouvement depuis ${formatOperationalDuration(age)}` };
  }
  if (isEtaOverdue(order, now)) return { code: 'eta_overdue', label: 'Livraison estimée dépassée' };
  return null;
}

/** Panel of the order detail page where the next action is carried out. */
export type OrderActionSection = 'actions' | 'preparation' | 'packing' | 'shipment' | 'tracking' | 'payment' | 'none';

export interface NextOrderAction { label: string; primary: boolean; intent: 'detail' | 'tracking' | 'incident'; section: OrderActionSection }

const action = (label: string, intent: NextOrderAction['intent'] = 'detail', primary = true, section: OrderActionSection = 'actions'): NextOrderAction => ({ label, intent, primary, section });

/** Next useful step, mapped onto existing backend flows only (order detail, carrier tracking). */
export function nextOrderAction(order: OperationalOrder, anomaly: OrderAnomaly | null = null): NextOrderAction {
  if (isTerminalOrder(order)) return action('Voir', 'detail', false, 'none');
  if (order.status === 'stock_conflict') return action('Vérifier le conflit');
  if (hasLogisticsIncident(order)) return action('Résoudre l’incident', 'incident', true, 'tracking');
  if (order.payment_status !== 'paid') return action('Vérifier le paiement', 'detail', true, 'payment');
  if (order.status === 'new' && (order.tenantPreparationMode ?? DIGITAL_PREPARATION).picking === 'paper') return action('Imprimer et démarrer');
  if (order.status === 'new') return action('Préparer');
  if (order.status === 'preparing') {
    const preparation = preparationState(order);
    if (!preparation.pickingDone) {
      return preparation.mode.picking === 'paper'
        ? action(order.paper_preparation_started_at || order.picking_list_printed_at ? 'Terminer la préparation' : 'Imprimer la liste', 'detail', true, 'preparation')
        : action('Poursuivre la préparation', 'detail', true, 'preparation');
    }
    if (order.fulfillment_type === 'pickup') return action('Marquer prête au retrait');
    if (!preparation.packingDone && !preparation.awaitingProviderParcels) {
      return action(preparation.mode.picking === 'none' ? 'Indiquer les colis' : 'Terminer l’emballage', 'detail', true, 'packing');
    }
    if (usesManagedShipment(order) && providerDraftToFinalize(order)) {
      const provider = providerDisplayName(order.shipping_provider_key);
      return action(provider ? `Finaliser dans ${provider}` : 'Finaliser l’expédition', 'detail', true, 'shipment');
    }
    if (usesManagedShipment(order)) return action(order.shipping_provider_reference ? 'Gérer l’expédition' : 'Associer l’expédition', 'detail', true, 'shipment');
    return action('Expédier');
  }
  if (order.status === 'ready_for_pickup') return action('Marquer retirée');
  if (order.status === 'shipped') {
    if (!order.tracking_code && !order.shipping_provider_reference) return action('Vérifier l’expédition');
    if (anomaly?.code === 'tracking_stale' || anomaly?.code === 'eta_overdue') return action('Vérifier le suivi', 'tracking', true, 'tracking');
    return action('Voir le suivi', 'tracking', false, 'tracking');
  }
  return action('Voir', 'detail', false, 'none');
}

export function orderHandlingFlags(order: OperationalOrder) {
  const rawDestination = order.fulfillment_type === 'delivery' ? order.shipping_address?.country?.trim().toUpperCase() : null;
  const rawOrigin = order.originCountry?.trim().toUpperCase();
  const normalize = (value: string) => ({ ITALIA: 'IT', ITALIE: 'IT', ITALY: 'IT', FRANCE: 'FR', GERMANY: 'DE', DEUTSCHLAND: 'DE', BELGIUM: 'BE', BELGIQUE: 'BE' }[value] ?? value);
  const international = Boolean(rawDestination && rawOrigin && normalize(rawDestination) !== normalize(rawOrigin));
  const fresh = Boolean(order.order_items?.some(item => item.storage_type === 'fresh'));
  const frozen = Boolean(order.order_items?.some(item => item.storage_type === 'frozen'));
  const actionable = order.payment_status === 'paid' && ['new', 'preparing'].includes(order.status);
  const score = actionable ? international && (fresh || frozen) ? 3 : fresh || frozen ? 2 : international ? 1 : 0 : 0;
  return { international, fresh, frozen, score };
}

export interface OrderOperation {
  group: PriorityGroup;
  handling: ReturnType<typeof orderHandlingFlags>;
  flags: Set<QueueKey>;
  anomaly: OrderAnomaly | null;
  /** Contextual delay ("En préparation depuis 18 j"), only beyond tenant thresholds. */
  urgency: string | null;
  /** Expected next step that is not an anomaly yet (e.g. shipment to associate). */
  notice: string | null;
  /** Timestamp driving the order inside its group. */
  operationalAt: string;
  action: NextOrderAction;
  /** Preparation step (new / preparing only), from preparationPolicy. */
  step: PreparationStep | null;
}

export function classifyOrderOperation(order: OperationalOrder, thresholds: OperationalThresholds, now: Date): OrderOperation {
  const flags = new Set<QueueKey>();
  const handling = orderHandlingFlags(order);
  if (isTerminalOrder(order)) {
    flags.add('finished');
    return { group: 'finished', handling, flags, anomaly: null, urgency: null, notice: null, operationalAt: order.updated_at, action: nextOrderAction(order), step: null };
  }

  const anomaly = orderAnomaly(order, thresholds, now);
  const readyToShip = isReadyToShip(order);
  const inPreparation = (order.status === 'new' || order.status === 'preparing') && !readyToShip;
  const preparationAge = hoursSince(preparationStartedAt(order), now);
  const pickupAge = hoursSince(order.updated_at, now); // last activity: no ready_for_pickup timestamp exists
  const preparationOverdue = inPreparation && preparationAge !== null && preparationAge >= thresholds.prepareHours;
  const pickupOverdue = order.status === 'ready_for_pickup' && pickupAge !== null && pickupAge >= thresholds.pickupHours;

  let group: PriorityGroup;
  let operationalAt: string;
  if (anomaly) { group = 'action_required'; operationalAt = order.created_at; }
  else if (preparationOverdue) { group = 'preparation_overdue'; operationalAt = preparationStartedAt(order); }
  else if (pickupOverdue) { group = 'pickup_overdue'; operationalAt = order.updated_at; }
  else if (readyToShip) { group = 'to_ship'; operationalAt = order.packing_completed_at ?? order.created_at; }
  else if (order.status === 'shipped') { group = 'shipping'; operationalAt = order.shipped_at ?? order.updated_at; }
  else if (order.status === 'ready_for_pickup') { group = 'pickup_ready'; operationalAt = order.updated_at; }
  else { group = 'preparing'; operationalAt = preparationStartedAt(order); }

  // A ready order whose provider draft waits for purchase beyond the preparation threshold.
  const draftAge = readyToShip && providerDraftToFinalize(order) ? hoursSince(order.shipping_creation_updated_at, now) : null;
  const draftOverdue = draftAge !== null && draftAge >= thresholds.prepareHours;

  if (handling.score === 3) flags.add('urgent');
  if (draftOverdue) flags.add('urgent');
  if (hasLogisticsIncident(order)) flags.add('incidents');
  if (['action_required', 'preparation_overdue', 'pickup_overdue'].includes(group)) flags.add('urgent');
  if (group !== 'shipping' && group !== 'pickup_ready') flags.add('to_treat');
  if (order.status === 'preparing') flags.add('preparing');
  if (readyToShip) flags.add('to_ship');
  if (order.status === 'shipped' && order.fulfillment_type === 'delivery' && MOVING_STATUSES.has(order.shipping_normalized_status as NormalizedShipmentStatus)) flags.add('in_transit');
  if (order.status === 'ready_for_pickup' && order.fulfillment_type === 'pickup') flags.add('pickup_ready');
  if (group === 'preparation_overdue') flags.add('late_preparation');
  if (group === 'pickup_overdue') flags.add('late_pickup');
  if (anomaly?.code === 'payment_unverified') flags.add('payment_unverified');
  if (order.status === 'stock_conflict') flags.add('stock_conflict');
  if (anomaly && ['shipped_without_tracking', 'tracking_stale', 'eta_overdue'].includes(anomaly.code)) flags.add('tracking_issues');

  const step = preparationStep(order, order.tenantPreparationMode ?? DIGITAL_PREPARATION);
  const preparation = preparationState(order);
  const pickupPrepared = order.fulfillment_type === 'pickup' && order.status === 'preparing' && preparation.pickingDone;
  if ((order.status === 'new' || order.status === 'preparing') && order.payment_status === 'paid' && !readyToShip && !pickupPrepared) {
    flags.add('to_prepare');
    if (step?.key === 'to_print') flags.add('to_print');
  }
  if (order.status === 'preparing') {
    if (preparation.mode.picking === 'digital' && !preparation.pickingDone) flags.add('picking_incomplete');
    if (order.fulfillment_type === 'delivery' && preparation.pickingDone && !preparation.packingDone && !preparation.awaitingProviderParcels) flags.add('packing_pending');
    if (order.fulfillment_type === 'delivery' && preparation.packingDone && !order.tracking_code) flags.add('tracking_missing');
    if (preparation.paperInProgress) flags.add('paper_in_progress');
  }
  // Chaîne du froid: only checks the order's mode expects in Lepefy (digital lines / digital packing check).
  if (['new', 'preparing', 'ready_for_pickup'].includes(order.status) && preparation.hasColdChain) {
    const lineMode = preparation.mode.picking;
    const linesPending = lineMode === 'digital' && (order.order_items ?? [])
      .some((item) => (item.storage_type === 'fresh' || item.storage_type === 'frozen') && !item.cold_chain_checked_at);
    const packingPending = order.fulfillment_type === 'delivery' && order.status === 'preparing' && preparation.pickingDone
      && preparation.mode.cold_chain_packing === 'digital' && !order.cold_chain_packing_checked_at;
    if (linesPending || packingPending) flags.add('cold_chain');
  }

  const urgency = preparationOverdue
    ? `${order.status === 'new' ? 'Ouverte' : 'En préparation'} depuis ${formatOperationalDuration(preparationAge!)}`
    : pickupOverdue ? `Inactive depuis ${formatOperationalDuration(pickupAge!)}`
    : draftOverdue ? `Brouillon ${providerDisplayName(order.shipping_provider_key) ?? 'transporteur'} à finaliser depuis ${formatOperationalDuration(draftAge!)}` : null;
  const notice = readyToShip && usesManagedShipment(order) && !order.shipping_provider_reference ? 'Expédition à associer' : null;

  return { group, handling, flags, anomaly, urgency, notice, operationalAt, action: nextOrderAction(order, anomaly), step };
}

/** Back-compat: queue flags of one order. */
export function orderQueueFlags(order: OperationalOrder, thresholds: OperationalThresholds, now: Date): Set<QueueKey> {
  return classifyOrderOperation(order, thresholds, now).flags;
}

/** Back-compat: the single contextual warning line of a row. */
export function urgencyLabel(order: OperationalOrder, thresholds: OperationalThresholds, now: Date): string | null {
  const operation = classifyOrderOperation(order, thresholds, now);
  return operation.anomaly?.code === 'tracking_stale' ? operation.anomaly.label : operation.urgency;
}

function timeOf(value: string | null | undefined): number {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? time : 0;
}

export interface PrioritizedOrder { order: OperationalOrder; operation: OrderOperation }

/**
 * "Priorité opérationnelle": group order, then oldest operational state first
 * (terminal: most recent first), then created_at and id for a stable result.
 */
export function compareOperationalPriority(a: PrioritizedOrder, b: PrioritizedOrder): number {
  const group = PRIORITY_GROUP_ORDER.indexOf(a.operation.group) - PRIORITY_GROUP_ORDER.indexOf(b.operation.group);
  if (group !== 0) return group;
  if (a.operation.group === 'preparing') {
    const handling = b.operation.handling.score - a.operation.handling.score;
    if (handling !== 0) return handling;
  }
  const direction = a.operation.group === 'finished' ? -1 : 1;
  const operational = (timeOf(a.operation.operationalAt) - timeOf(b.operation.operationalAt)) * direction;
  if (operational !== 0) return operational;
  const created = (timeOf(a.order.created_at) - timeOf(b.order.created_at)) * direction;
  if (created !== 0) return created;
  return (a.order.id ?? '').localeCompare(b.order.id ?? '');
}

export type OrderSortKey = 'priority' | 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';

export const ORDER_SORT_OPTIONS: ReadonlyArray<{ key: OrderSortKey; label: string }> = [
  { key: 'priority', label: 'Priorité opérationnelle' },
  { key: 'newest', label: 'Plus récentes' },
  { key: 'oldest', label: 'Plus anciennes' },
  { key: 'amount_desc', label: 'Montant décroissant' },
  { key: 'amount_asc', label: 'Montant croissant' },
];

const LEGACY_SORTS: Record<string, OrderSortKey> = { date_desc: 'newest', date_asc: 'oldest', total_desc: 'amount_desc', total_asc: 'amount_asc' };

/** Query-string sort; "priority" is the default, legacy keys stay accepted. */
export function parseOrderSort(raw: string | undefined | null): OrderSortKey {
  if (!raw) return 'priority';
  if (raw in LEGACY_SORTS) return LEGACY_SORTS[raw]!;
  return ORDER_SORT_OPTIONS.some((option) => option.key === raw) ? raw as OrderSortKey : 'priority';
}

/** In-memory comparator for every sort key (used on the classified active set). */
export function compareOrders(sort: OrderSortKey, a: PrioritizedOrder, b: PrioritizedOrder): number {
  const tie = () => timeOf(b.order.created_at) - timeOf(a.order.created_at) || (a.order.id ?? '').localeCompare(b.order.id ?? '');
  if (sort === 'priority') return compareOperationalPriority(a, b);
  if (sort === 'oldest') return timeOf(a.order.created_at) - timeOf(b.order.created_at) || (a.order.id ?? '').localeCompare(b.order.id ?? '');
  if (sort === 'amount_desc') return Number(b.order.total ?? 0) - Number(a.order.total ?? 0) || tie();
  if (sort === 'amount_asc') return Number(a.order.total ?? 0) - Number(b.order.total ?? 0) || tie();
  return tie();
}

/** Carrier-side state shown apart from the internal order status (null for pickup). */
export function transportState(order: Pick<OperationalOrder, 'status' | 'fulfillment_type' | 'shipping_sync_error' | 'shipping_provider_reference' | 'shipping_normalized_status' | 'shipping_tracking_mode' | 'tracking_code' | 'shipping_creation_status' | 'shipping_provider_key'>):
  { label: string; tone: 'danger' | 'warning' | 'success' | 'neutral' } | null {
  if (order.fulfillment_type === 'pickup') return null;
  if (order.shipping_sync_error === SHIPPING_SYNC_PREPARATION_INCOMPLETE) return { label: 'En transit · préparation à valider', tone: 'danger' };
  if (order.shipping_sync_error) return { label: 'Synchro en erreur', tone: 'danger' };
  if (providerDraftToFinalize(order)) {
    const provider = providerDisplayName(order.shipping_provider_key);
    return { label: provider ? `à finaliser dans ${provider}` : 'brouillon à finaliser', tone: 'warning' };
  }
  if (order.shipping_provider_reference) {
    const status = order.shipping_normalized_status;
    return { label: shipmentStatusLabel(status), tone: status && INCIDENT_STATUSES.has(status) ? 'danger' : status === 'delivered' ? 'success' : 'neutral' };
  }
  if (order.shipping_tracking_mode === 'manual' || order.tracking_code) return { label: 'Suivi manuel', tone: 'neutral' };
  return { label: 'Non associée', tone: 'neutral' };
}

export interface OrderTransition { status: OrderStatus; label: string }

/**
 * Status transition offered by the order detail page (executed server-side by
 * PATCH /api/admin/orders/[id] → orderTransitionService). With a managed
 * shipment, shipping and delivery come from the provider sync, not a button.
 */
export function orderDetailTransition(order: Pick<OperationalOrder, 'status' | 'fulfillment_type'>, managed: boolean): OrderTransition | null {
  const pickup = order.fulfillment_type === 'pickup';
  let transition: OrderTransition | null = null;
  if (order.status === 'new') transition = { status: 'preparing', label: 'Démarrer la préparation' };
  else if (order.status === 'preparing') transition = pickup ? { status: 'ready_for_pickup', label: 'Marquer prête au retrait' } : { status: 'shipped', label: 'Expédier la commande' };
  else if (order.status === 'ready_for_pickup' && pickup) transition = { status: 'delivered', label: 'Marquer comme retirée' };
  else if (order.status === 'shipped' && !pickup) transition = { status: 'delivered', label: 'Marquer comme livrée' };
  if (transition && managed && !pickup && (transition.status === 'shipped' || transition.status === 'delivered')) return null;
  return transition;
}
