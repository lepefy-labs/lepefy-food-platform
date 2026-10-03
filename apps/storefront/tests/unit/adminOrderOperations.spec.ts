import { test, expect } from '@playwright/test';
import {
  classifyOrderOperation, compareOrders, formatOperationalDuration, formatSince, hasLogisticsIncident, isTrackingStale,
  nextOrderAction, orderDetailTransition, orderQueueFlags, parseOrderSort, transportState, urgencyLabel,
  type OperationalOrder, type PrioritizedOrder,
} from '../../src/lib/orders/adminOrderOperations';
import { shipmentEventLabel, shipmentEventsNewestFirst } from '../../src/lib/shipping/shipmentPresentation';

const now = new Date('2026-10-02T12:00:00Z');
const thresholds = { prepareHours: 24, pickupHours: 48, trackingStaleHours: 72 };
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const base: OperationalOrder = {
  id: '00000000-0000-4000-8000-000000000000',
  status: 'new', fulfillment_type: 'delivery', payment_status: 'paid',
  created_at: hoursAgo(4), updated_at: hoursAgo(4),
  picking_started_at: null, picking_completed_at: null, packing_completed_at: null,
  shipping_tracking_mode: 'manual', shipping_provider_reference: null,
  shipping_normalized_status: null, shipping_sync_error: null, shipping_tracking_events: null,
  shipping_estimated_delivery_at: null, tracking_code: null,
};
const make = (patch: Partial<OperationalOrder> = {}): OperationalOrder => ({ ...base, ...patch });
const classify = (order: OperationalOrder) => classifyOrderOperation(order, thresholds, now);
const prioritized = (order: OperationalOrder): PrioritizedOrder => ({ order, operation: classify(order) });
const sortIds = (orders: OperationalOrder[], sort: Parameters<typeof compareOrders>[0] = 'priority') =>
  orders.map(prioritized).sort((a, b) => compareOrders(sort, a, b)).map(({ order }) => order.id);
const moving = (lastEventHoursAgo: number): Partial<OperationalOrder> => ({
  status: 'shipped', shipping_provider_reference: 'PK1', tracking_code: 'TRK1', shipping_normalized_status: 'in_transit', shipped_at: hoursAgo(lastEventHoursAgo + 10),
  shipping_tracking_events: [{ occurredAt: hoursAgo(lastEventHoursAgo), description: 'Pris en charge', providerStatus: null, status: 'in_transit' }],
});

test.describe('next action', () => {
  test('follows the real state machine with business wording', () => {
    expect(nextOrderAction(make()).label).toBe('Préparer');
    expect(nextOrderAction(make({ status: 'preparing' })).label).toBe('Poursuivre la préparation');
    expect(nextOrderAction(make({ status: 'preparing', fulfillment_type: 'pickup', picking_completed_at: hoursAgo(1) })).label).toBe('Marquer prête au retrait');
    expect(nextOrderAction(make({ status: 'preparing', picking_completed_at: hoursAgo(1) })).label).toBe('Terminer l’emballage');
    const ready = make({ status: 'preparing', picking_completed_at: hoursAgo(1), packing_completed_at: hoursAgo(1) });
    expect(nextOrderAction(ready).label).toBe('Expédier');
    expect(nextOrderAction({ ...ready, shipping_tracking_mode: null, managedProviderAvailable: true }).label).toBe('Associer l’expédition');
    expect(nextOrderAction({ ...ready, shipping_tracking_mode: 'managed', shipping_provider_reference: 'PK1' }).label).toBe('Gérer l’expédition');
    expect(nextOrderAction(make({ status: 'ready_for_pickup', fulfillment_type: 'pickup' })).label).toBe('Marquer retirée');
  });

  test('shipped: tracking is a secondary consultation, missing tracking is corrective', () => {
    expect(nextOrderAction(make({ status: 'shipped', tracking_code: 'TRK1' }))).toEqual({ label: 'Voir le suivi', intent: 'tracking', primary: false, section: 'tracking' });
    expect(nextOrderAction(make({ status: 'shipped', shipping_provider_reference: 'PK1' })).label).toBe('Voir le suivi');
    expect(nextOrderAction(make({ status: 'shipped' }))).toEqual({ label: 'Vérifier l’expédition', intent: 'detail', primary: true, section: 'actions' });
    expect(classify(make(moving(100))).action).toEqual({ label: 'Vérifier le suivi', intent: 'tracking', primary: true, section: 'tracking' });
  });

  test('terminal orders get a neutral consultation, incidents a corrective action', () => {
    for (const status of ['delivered', 'cancelled'] as const) expect(nextOrderAction(make({ status }))).toEqual({ label: 'Voir', intent: 'detail', primary: false, section: 'none' });
    for (const patch of [{ shipping_normalized_status: 'exception' as const }, { shipping_normalized_status: 'returned' as const }, { shipping_sync_error: 'provider_error' }]) {
      const order = make({ status: 'shipped', tracking_code: 'TRK1', ...patch });
      expect(hasLogisticsIncident(order)).toBe(true);
      expect(nextOrderAction(order).label).toBe('Résoudre l’incident');
    }
    expect(hasLogisticsIncident(make({ fulfillment_type: 'pickup', shipping_normalized_status: 'exception' }))).toBe(false);
    expect(nextOrderAction(make({ status: 'stock_conflict' })).label).toBe('Vérifier le conflit');
    expect(nextOrderAction(make({ payment_status: 'pending' })).label).toBe('Vérifier le paiement');
  });
});

test.describe('urgency and durations', () => {
  test('hours below 48 h, days from 48 h on', () => {
    expect(formatOperationalDuration(26)).toBe('26 h');
    expect(formatOperationalDuration(47.9)).toBe('47 h');
    expect(formatOperationalDuration(48)).toBe('2 j');
    expect(formatOperationalDuration(432)).toBe('18 j');
    expect(formatOperationalDuration(0.2)).toBe('moins d’1 h');
    expect(formatSince(hoursAgo(72), now)).toBe('il y a 3 j');
  });

  test('preparation overdue uses the tenant threshold and the picking start', () => {
    expect(urgencyLabel(make({ status: 'preparing', picking_started_at: hoursAgo(26) }), thresholds, now)).toBe('En préparation depuis 26 h');
    expect(urgencyLabel(make({ status: 'preparing', picking_started_at: hoursAgo(432) }), thresholds, now)).toBe('En préparation depuis 18 j');
    expect(urgencyLabel(make({ created_at: hoursAgo(30) }), thresholds, now)).toBe('Ouverte depuis 30 h');
    expect(urgencyLabel(make({ status: 'preparing', picking_started_at: hoursAgo(10) }), thresholds, now)).toBeNull();
  });

  test('stale tracking and overdue pickup are detected from persisted data', () => {
    const stale = make(moving(100));
    expect(isTrackingStale(stale, thresholds, now)).toBe(true);
    expect(urgencyLabel(stale, thresholds, now)).toBe('Suivi sans mouvement depuis 4 j');
    expect(isTrackingStale(make(moving(10)), thresholds, now)).toBe(false);
    expect(isTrackingStale({ ...stale, shipping_tracking_events: null }, thresholds, now)).toBe(false);
    const pickup = make({ status: 'ready_for_pickup', fulfillment_type: 'pickup', updated_at: hoursAgo(72) });
    expect(classify(pickup).group).toBe('pickup_overdue');
    expect(classify(pickup).urgency).toBe('Inactive depuis 3 j');
    expect(classify({ ...pickup, updated_at: hoursAgo(5) }).group).toBe('pickup_ready');
  });

  test('no warning on a normal state', () => {
    for (const order of [make(), make({ status: 'preparing', picking_started_at: hoursAgo(2) }), make(moving(5)), make({ status: 'ready_for_pickup', fulfillment_type: 'pickup' })]) {
      const operation = classify(order);
      expect(operation.anomaly).toBeNull();
      expect(operation.urgency).toBeNull();
      expect(operation.notice).toBeNull();
    }
    const packed = make({ status: 'preparing', picking_completed_at: hoursAgo(1), packing_completed_at: hoursAgo(1), shipping_tracking_mode: 'managed' });
    expect(classify(packed).notice).toBe('Expédition à associer');
    expect(classify({ ...packed, shipping_provider_reference: 'PK1' }).notice).toBeNull();
  });
});

test.describe('work queue classification', () => {
  test('KPI flags: "À traiter" means a real action, not just "not finished"', () => {
    expect(orderQueueFlags(make(), thresholds, now).has('to_treat')).toBe(true);
    expect(orderQueueFlags(make({ status: 'preparing' }), thresholds, now).has('to_treat')).toBe(true);
    const packed = make({ status: 'preparing', picking_completed_at: hoursAgo(1), packing_completed_at: hoursAgo(1) });
    expect([...orderQueueFlags(packed, thresholds, now)].sort()).toEqual(['preparing', 'to_ship', 'to_treat']);
    const transit = orderQueueFlags(make(moving(5)), thresholds, now);
    expect(transit.has('in_transit')).toBe(true);
    expect(transit.has('to_treat')).toBe(false);
    const pickup = orderQueueFlags(make({ status: 'ready_for_pickup', fulfillment_type: 'pickup' }), thresholds, now);
    expect(pickup.has('pickup_ready')).toBe(true);
    expect(pickup.has('to_treat')).toBe(false);
    expect(orderQueueFlags(make({ status: 'ready_for_pickup', fulfillment_type: 'pickup', updated_at: hoursAgo(72) }), thresholds, now).has('to_treat')).toBe(true);
  });

  test('"Incidents" only holds provider-confirmed anomalies; terminal orders are only "Terminés"', () => {
    expect(orderQueueFlags(make({ status: 'shipped', shipping_provider_reference: 'PK1', shipping_normalized_status: 'exception' }), thresholds, now).has('incidents')).toBe(true);
    const stale = orderQueueFlags(make(moving(100)), thresholds, now);
    expect(stale.has('incidents')).toBe(false);
    expect(stale.has('urgent')).toBe(true);
    for (const status of ['delivered', 'cancelled'] as const) {
      expect([...orderQueueFlags(make({ status, shipping_normalized_status: 'exception' }), thresholds, now)]).toEqual(['finished']);
    }
  });
});

test.describe('operational priority', () => {
  const incident = make({ id: 'a-incident', status: 'shipped', shipping_provider_reference: 'PK1', shipping_normalized_status: 'exception', created_at: hoursAgo(5) });
  const prepLate = make({ id: 'b-prep-late', status: 'preparing', picking_started_at: hoursAgo(100), created_at: hoursAgo(120) });
  const prepLater = make({ id: 'c-prep-later', status: 'preparing', picking_started_at: hoursAgo(30), created_at: hoursAgo(31) });
  const pickupLate = make({ id: 'd-pickup-late', status: 'ready_for_pickup', fulfillment_type: 'pickup', updated_at: hoursAgo(80) });
  const freshNew = make({ id: 'e-new', created_at: hoursAgo(2) });
  const olderNew = make({ id: 'f-new-older', created_at: hoursAgo(6) });
  const packed = make({ id: 'g-packed', status: 'preparing', picking_completed_at: hoursAgo(2), packing_completed_at: hoursAgo(1), created_at: hoursAgo(60) });
  const transit = make({ id: 'h-transit', ...moving(5) });
  const pickup = make({ id: 'i-pickup', status: 'ready_for_pickup', fulfillment_type: 'pickup', updated_at: hoursAgo(3) });
  const deliveredOld = make({ id: 'j-delivered-old', status: 'delivered', updated_at: hoursAgo(300) });
  const deliveredRecent = make({ id: 'k-delivered-recent', status: 'delivered', updated_at: hoursAgo(3) });

  test('groups follow the operational order', () => {
    const shuffled = [deliveredOld, pickup, transit, freshNew, packed, deliveredRecent, olderNew, pickupLate, prepLater, prepLate, incident];
    expect(sortIds(shuffled)).toEqual([
      'a-incident', 'b-prep-late', 'c-prep-later', 'd-pickup-late', 'f-new-older', 'e-new', 'g-packed', 'h-transit', 'i-pickup', 'k-delivered-recent', 'j-delivered-old',
    ]);
  });

  test('incident > preparation overdue > active preparation; active > delivered', () => {
    expect(sortIds([prepLate, incident])).toEqual(['a-incident', 'b-prep-late']);
    expect(sortIds([freshNew, prepLate])).toEqual(['b-prep-late', 'e-new']);
    expect(sortIds([pickup, pickupLate])).toEqual(['d-pickup-late', 'i-pickup']);
    expect(sortIds([deliveredRecent, transit])).toEqual(['h-transit', 'k-delivered-recent']);
  });

  test('same group: oldest first; terminal: most recent first; ties are stable by id', () => {
    expect(sortIds([freshNew, olderNew])).toEqual(['f-new-older', 'e-new']);
    expect(sortIds([deliveredOld, deliveredRecent])).toEqual(['k-delivered-recent', 'j-delivered-old']);
    const twinA = make({ id: 'twin-a', created_at: hoursAgo(3) });
    const twinB = make({ id: 'twin-b', created_at: hoursAgo(3) });
    expect(sortIds([twinB, twinA])).toEqual(['twin-a', 'twin-b']);
    expect(sortIds([twinA, twinB])).toEqual(['twin-a', 'twin-b']);
  });

  test('other sorts and query-string parsing', () => {
    const cheap = make({ id: 'cheap', total: 10, created_at: hoursAgo(1) });
    const rich = make({ id: 'rich', total: 90, created_at: hoursAgo(9) });
    expect(sortIds([cheap, rich], 'amount_desc')).toEqual(['rich', 'cheap']);
    expect(sortIds([rich, cheap], 'newest')).toEqual(['cheap', 'rich']);
    expect(sortIds([cheap, rich], 'oldest')).toEqual(['rich', 'cheap']);
    expect(parseOrderSort(undefined)).toBe('priority');
    expect(parseOrderSort('date_desc')).toBe('newest');
    expect(parseOrderSort('total_desc')).toBe('amount_desc');
    expect(parseOrderSort('amount_asc')).toBe('amount_asc');
    expect(parseOrderSort('drop table')).toBe('priority');
  });
});

test.describe('order detail alignment', () => {
  test('each next action points to the panel where it is carried out', () => {
    const section = (patch: Partial<OperationalOrder>, extra: Partial<OperationalOrder> = {}) => nextOrderAction(make({ ...patch, ...extra })).section;
    expect(section({ status: 'preparing' })).toBe('preparation');
    expect(section({ status: 'preparing', picking_completed_at: hoursAgo(1) })).toBe('packing');
    expect(section({ status: 'preparing', picking_completed_at: hoursAgo(1), packing_completed_at: hoursAgo(1), shipping_tracking_mode: 'managed' })).toBe('shipment');
    expect(section({ status: 'shipped', shipping_provider_reference: 'PK1', shipping_normalized_status: 'exception' })).toBe('tracking');
    expect(section({ payment_status: 'pending' })).toBe('payment');
    for (const patch of [{}, { status: 'ready_for_pickup' as const, fulfillment_type: 'pickup' as const }, { status: 'preparing' as const, fulfillment_type: 'pickup' as const, picking_completed_at: hoursAgo(1) }]) {
      expect(section(patch)).toBe('actions');
    }
  });

  test('detail transitions follow the state machine; managed shipments ship and deliver through sync', () => {
    expect(orderDetailTransition(make(), false)).toEqual({ status: 'preparing', label: 'Démarrer la préparation' });
    expect(orderDetailTransition(make({ status: 'preparing' }), false)).toEqual({ status: 'shipped', label: 'Expédier la commande' });
    expect(orderDetailTransition(make({ status: 'preparing' }), true)).toBeNull();
    expect(orderDetailTransition(make({ status: 'shipped' }), false)).toEqual({ status: 'delivered', label: 'Marquer comme livrée' });
    expect(orderDetailTransition(make({ status: 'shipped' }), true)).toBeNull();
    expect(orderDetailTransition(make({ status: 'preparing', fulfillment_type: 'pickup' }), false)).toEqual({ status: 'ready_for_pickup', label: 'Marquer prête au retrait' });
    expect(orderDetailTransition(make({ status: 'ready_for_pickup', fulfillment_type: 'pickup' }), false)).toEqual({ status: 'delivered', label: 'Marquer comme retirée' });
    for (const status of ['delivered', 'cancelled', 'stock_conflict'] as const) expect(orderDetailTransition(make({ status }), false)).toBeNull();
  });

  test('transport state stays separate from the order status', () => {
    expect(transportState(make({ fulfillment_type: 'pickup' }))).toBeNull();
    expect(transportState(make())).toEqual({ label: 'Suivi manuel', tone: 'neutral' });
    expect(transportState(make({ shipping_tracking_mode: 'managed' }))).toEqual({ label: 'Non associée', tone: 'neutral' });
    expect(transportState(make({ shipping_provider_reference: 'PK1', shipping_normalized_status: 'exception' }))).toEqual({ label: 'Incident', tone: 'danger' });
    expect(transportState(make({ shipping_provider_reference: 'PK1', shipping_normalized_status: 'delivered' }))).toEqual({ label: 'Livré', tone: 'success' });
    expect(transportState(make({ shipping_provider_reference: 'PK1', shipping_sync_error: 'timeout' }))).toEqual({ label: 'Synchro en erreur', tone: 'danger' });
  });

  test('tracking timeline is newest first, drops malformed events and keeps carrier wording readable', () => {
    const events = shipmentEventsNewestFirst([
      { occurredAt: '2026-09-30T11:25:00Z', description: 'RITIRATA', providerStatus: null, status: 'in_transit' },
      { occurredAt: 'not a date', description: 'x', providerStatus: null, status: 'unknown' },
      { occurredAt: '2026-10-01T08:10:00Z', description: 'IN CONSEGNA', providerStatus: null, status: 'out_for_delivery' },
    ]);
    expect(events.map(shipmentEventLabel)).toEqual(['En livraison', 'Pris en charge']);
  });
});
