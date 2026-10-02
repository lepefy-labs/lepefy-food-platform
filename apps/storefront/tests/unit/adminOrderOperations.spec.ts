import { test, expect } from '@playwright/test';
import { hasLogisticsIncident, isTrackingStale, nextOrderAction, orderQueueFlags, urgencyLabel, type OperationalOrder } from '../../src/lib/orders/adminOrderOperations';

const now = new Date('2026-10-02T12:00:00Z');
const thresholds = { prepareHours: 24, pickupHours: 48, trackingStaleHours: 72 };
const base: OperationalOrder = {
  status: 'new', fulfillment_type: 'delivery', payment_status: 'paid',
  created_at: '2026-10-02T08:00:00Z', updated_at: '2026-10-02T08:00:00Z',
  picking_started_at: null, picking_completed_at: null, packing_completed_at: null,
  shipping_tracking_mode: 'manual', shipping_provider_reference: null,
  shipping_normalized_status: null, shipping_sync_error: null, shipping_tracking_events: null,
  shipping_estimated_delivery_at: null, tracking_code: null,
};
const make = (patch: Partial<OperationalOrder> = {}): OperationalOrder => ({ ...base, ...patch });

test('new order is actionable; finished orders are secondary', () => {
  expect(nextOrderAction(make()).label).toBe('Préparer');
  expect(orderQueueFlags(make(), thresholds, now).has('to_treat')).toBe(true);
  for (const status of ['delivered', 'cancelled'] as const) {
    expect(nextOrderAction(make({ status }))).toEqual({ label: 'Voir', intent: 'detail', primary: false });
    expect([...orderQueueFlags(make({ status }), thresholds, now)]).toEqual(['finished']);
  }
});

test('preparation follows picking, packing and fulfillment mode', () => {
  const preparing = make({ status: 'preparing' });
  expect(nextOrderAction(preparing).label).toBe('Continuer le picking');
  expect(nextOrderAction(make({ status: 'preparing', fulfillment_type: 'pickup', picking_completed_at: now.toISOString() })).label).toBe('Marquer prête au retrait');
  expect(nextOrderAction(make({ status: 'preparing', picking_completed_at: now.toISOString() })).label).toBe('Terminer le packing');
  const ready = make({ status: 'preparing', picking_completed_at: now.toISOString(), packing_completed_at: now.toISOString() });
  expect(orderQueueFlags(ready, thresholds, now).has('to_ship')).toBe(true);
  expect(nextOrderAction(ready).label).toBe('Expédier');
  expect(nextOrderAction({ ...ready, shipping_tracking_mode: null, managedProviderAvailable: true }).label).toBe('Associer l’expédition');
  expect(nextOrderAction({ ...ready, shipping_tracking_mode: 'managed' }).label).toBe('Associer l’expédition');
  expect(nextOrderAction({ ...ready, shipping_tracking_mode: 'managed', shipping_provider_reference: 'PK1' }).label).toBe('Gérer l’expédition');
});

test('pickup ready, shipped with and without tracking use distinct actions', () => {
  const pickup = make({ status: 'ready_for_pickup', fulfillment_type: 'pickup' });
  expect(nextOrderAction(pickup).label).toBe('Marquer retirée');
  expect(orderQueueFlags(pickup, thresholds, now).has('pickup_ready')).toBe(true);
  const shipped = make({ status: 'shipped' });
  expect(nextOrderAction(shipped).label).toBe('Vérifier l’expédition');
  expect(nextOrderAction({ ...shipped, tracking_code: 'TRACK1' }).label).toBe('Voir le suivi');
  expect(orderQueueFlags({ ...shipped, shipping_normalized_status: 'in_transit' }, thresholds, now).has('in_transit')).toBe(true);
});

test('provider exception and sync error override normal shipping actions', () => {
  for (const patch of [{ shipping_normalized_status: 'exception' as const }, { shipping_normalized_status: 'returned' as const }, { shipping_sync_error: 'provider_error' }]) {
    const order = make({ status: 'shipped', tracking_code: 'TRACK1', ...patch });
    expect(hasLogisticsIncident(order)).toBe(true);
    expect(nextOrderAction(order).label).toBe('Résoudre l’incident');
    expect(orderQueueFlags(order, thresholds, now).has('incidents')).toBe(true);
  }
  expect(hasLogisticsIncident(make({ fulfillment_type: 'pickup', shipping_normalized_status: 'exception' }))).toBe(false);
});

test('stale tracking and contextual urgency use persisted timestamps', () => {
  const stale = make({ status: 'shipped', shipping_provider_reference: 'PK1', shipping_normalized_status: 'in_transit',
    shipping_tracking_events: [{ occurredAt: '2026-09-28T10:00:00Z', description: 'Pris en charge', providerStatus: null, status: 'in_transit' }] });
  expect(isTrackingStale(stale, thresholds, now)).toBe(true);
  expect(urgencyLabel(stale, thresholds, now)).toContain('Suivi sans mouvement');
  expect(isTrackingStale({ ...stale, shipping_tracking_events: null }, thresholds, now)).toBe(false);
  const preparing = make({ status: 'preparing', picking_started_at: '2026-10-01T10:00:00Z' });
  expect(orderQueueFlags(preparing, thresholds, now).has('urgent')).toBe(true);
  expect(urgencyLabel(preparing, thresholds, now)).toBe('En préparation depuis 26 h');
});
