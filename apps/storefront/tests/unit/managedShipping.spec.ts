import { expect, test } from '@playwright/test';
import type { Order } from '@lepefy/types';
import { packlinkAdapter, parsePacklinkShipment, normalizePacklinkStatus, resolveTrackingUrl } from '../../src/lib/shipping/providers/packlink';
import { managedShippingProviderInfo } from '../../src/lib/shipping/providers/registry';
import { applyShipmentSnapshot, syncOrderShipment } from '../../src/lib/shipping/syncOrderShipment';
import { loadWorkflowOrder, updateWorkflowOrder, type OrderService } from '../../src/lib/orders/orderTransitionService';
import { runOrderTransitionSideEffects } from '../../src/lib/orders/adminOrderWorkflow';
import type { TenantNotificationContext } from '../../src/lib/notifications/getTenantNotificationContext';
import { shipmentEventLabel, shipmentEventsNewestFirst } from '../../src/lib/shipping/shipmentPresentation';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { shippingSyncAuthorized } from '../../src/lib/shipping/shippingSyncAuth';
import { runShippingSyncBatch } from '../../src/lib/shipping/shippingSyncBatch';

const reference = 'IT2026PRC0005858260';
const payload = { trackings: ['fallback'], carrier_shipment_tracking_number: '179196133702310',
  tracking_url: 'https://services.brt.it/it/tracking?CD=%5Btracking%5D', estimated_delivery_date: '2026/09/15', carrier_product_id: 'ACI_BRT_IT_S2H_DPD' };
const timeline = [
  { timestamp: 1788940800, description: 'RITIRATA', status_code: 'READY_FOR_COLLECTION' },
  { timestamp: 1788958680, description: 'DATI SPEDIZ. TRASMESSI A BRT', status_code: 'READY_FOR_COLLECTION' },
  { timestamp: 1788973200, description: 'PARTITA', status_code: 'IN_TRANSIT' },
  { timestamp: 1789416000, description: 'IN CONSEGNA', status_code: 'IN_TRANSIT' },
  { timestamp: 1789467120, description: 'DA RITIRARE AL PARCEL SHOP', status_code: 'OUT_FOR_DELIVERY_03' },
  { timestamp: 1789558500, description: 'CONSEGNATA', status_code: 'DELIVERED' },
];
const snapshot = (status: string) => parsePacklinkShipment(reference, payload, [{ timestamp: 1788973200, description: status, status_code: status }]);
const initialOrder = (patch: Partial<Order> = {}): Order => ({
  id: 'order-a', tenant_id: 'tenant-a', status: 'preparing', fulfillment_type: 'delivery', email: 'test@example.invalid',
  full_name: 'Test', tracking_code: null, tracking_carrier: null, shipped_at: null,
  picking_started_at: '2026-09-01T00:00:00Z', packing_completed_at: '2026-09-01T00:00:00Z', packing_parcel_count: 1,
  cold_chain_packing_checked_at: '2026-09-01T00:00:00Z', updated_at: 'v0', shipping_provider_key: null,
  shipping_tracking_mode: null, shipping_provider_reference: null, ...patch,
} as Order);

/** Fluent fake enforces the same filters/CAS as PostgREST; no network or notifications. */
function fakeService(order = initialOrder()) {
  const rows: Record<string, Record<string, unknown>[]> = {
    orders: [{ ...order }], tenants: [{ id: 'tenant-a', shipping_provider: 'packlink', packlink_api_key: 'tenant-a-test-key' }],
    order_items: [{ order_id: 'order-a', tenant_id: 'tenant-a', storage_type: 'fresh', picked_at: 'yes', cold_chain_checked_at: 'yes' }],
  };
  let revision = 0;
  const queries: string[] = [];
  const raw = {
    from(table: string) {
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      let patch: Record<string, unknown> | undefined;
      let limit = Infinity;
      const query = {
        select(columns: string) { queries.push(table + ':' + columns); return query; },
        eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
        not(key: string, _operator: string, _value: unknown) { filters.push(row => row[key] != null); return query; },
        in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
        or(_filter: string) { filters.push(row => !['delivered', 'returned', 'cancelled'].includes(String(row.shipping_normalized_status))); return query; },
        order(_key: string, _options?: unknown) { return query; },
        limit(value: number) { limit = value; return query; },
        update(value: Record<string, unknown>) { patch = value; return query; },
        async maybeSingle() {
          const result = execute(); return { data: result.data[0] ?? null, error: null };
        },
        then(resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown) { return Promise.resolve(execute()).then(resolve); },
      };
      function execute() {
        const matches = (rows[table] ?? []).filter(row => filters.every(filter => filter(row))).slice(0, limit);
        if (patch) for (const row of matches) Object.assign(row, patch, { updated_at: `v${++revision}` });
        return { data: matches.map(row => ({ ...row })), error: null };
      }
      return query;
    },
  };
  return { service: raw as unknown as OrderService, rows, queries, order: () => ({ ...rows.orders![0] }) as unknown as Order };
}

function effects() {
  const hooks: string[] = [];
  const messages: { path: string; payload: Record<string, unknown> }[] = [];
  const context = { tenantId: 'tenant-a', tenantName: 'Test', storefrontUrl: 'https://test.example.invalid' } as TenantNotificationContext;
  const run: typeof runOrderTransitionSideEffects = args => runOrderTransitionSideEffects(args, {
    processOrderPointsOnDelivery: async id => { hooks.push(id); },
    notifyN8n: async (path, payload) => { messages.push({ path, payload }); return true; },
    getTenantNotificationContext: async () => context,
  });
  return { hooks, messages, run };
}
test.beforeEach(() => { process.env.N8N_WEBHOOK_URL = 'https://unused.example.invalid'; });
test.afterEach(() => { delete process.env.N8N_WEBHOOK_URL; });

test('real Packlink payload, primary tracking code, URL and complete timeline', () => {
  const result = parsePacklinkShipment(reference, payload, timeline);
  expect(result.trackingCode).toBe('179196133702310');
  expect(result.carrier).toBe('BRT');
  expect(result.trackingUrl).toBe('https://services.brt.it/it/tracking?CD=179196133702310');
  expect(result.estimatedDeliveryAt).toBe('2026-09-15T00:00:00.000Z');
  expect(result.events).toHaveLength(6);
  expect(result.normalizedStatus).toBe('delivered');
  expect(shipmentEventLabel(shipmentEventsNewestFirst(result.events)[0]!)).toBe('Livré');
  expect(result.events[4]!.status).toBe('out_for_delivery');
  expect(parsePacklinkShipment(reference, { ...payload, carrier_shipment_tracking_number: null }, []).trackingCode).toBe('fallback');
});
test('literal and encoded placeholders encode tracking; unsafe links are discarded', () => {
  for (const template of ['[tracking]', '%5Btracking%5D']) expect(resolveTrackingUrl('https://example.invalid/?id=' + template, 'a b&c')).toBe('https://example.invalid/?id=a%20b%26c');
  expect(resolveTrackingUrl('javascript:alert(1)', 'abc')).toBeNull();
  expect(resolveTrackingUrl('https://example.invalid/[tracking]', null)).toBeNull();
});
for (const [external, current, expected] of [
  ['READY_FOR_COLLECTION', 'preparing', 'preparing'], ['IN_TRANSIT', 'preparing', 'shipped'],
  ['OUT_FOR_DELIVERY_03', 'shipped', 'shipped'], ['DELIVERED', 'shipped', 'delivered'],
] as const) test(`${external}: ${current} -> ${expected}`, async () => {
  const db = fakeService(initialOrder({ status: current })); const spy = effects();
  await applyShipmentSnapshot(db.service, db.order(), snapshot(external), spy.run);
  expect(db.order().status).toBe(expected);
  expect(spy.messages).toHaveLength(expected !== current ? 1 : 0);
  if (expected === 'delivered') expect(spy.hooks).toHaveLength(1);
});
test('repeated transit and delivered snapshots do not duplicate canonical webhooks or loyalty', async () => {
  const db = fakeService(); const spy = effects();
  for (const status of ['IN_TRANSIT', 'IN_TRANSIT', 'DELIVERED', 'DELIVERED']) await applyShipmentSnapshot(db.service, db.order(), snapshot(status), spy.run);
  expect(spy.messages.map(message => message.path)).toEqual(['/webhook/order-shipped', '/webhook/order-completed']);
  expect(spy.hooks).toEqual(['order-a']);
  expect(spy.messages[1]!.payload.completionType).toBe('delivered');
  expect(db.order().shipped_at).toBeTruthy();
});
test('initial delivered catch-up emits completion only; still requires preparation', async () => {
  const db = fakeService(); const spy = effects();
  await applyShipmentSnapshot(db.service, db.order(), parsePacklinkShipment(reference, payload, timeline), spy.run);
  expect(db.order().status).toBe('delivered');
  expect(db.order().shipped_at).toBe(new Date(1788973200 * 1000).toISOString());
  expect(spy.messages.map(message => message.path)).toEqual(['/webhook/order-completed']);
  expect(spy.hooks).toHaveLength(1);
  const blocked = fakeService(initialOrder({ packing_completed_at: null }));
  await expect(applyShipmentSnapshot(blocked.service, blocked.order(), snapshot('DELIVERED'), spy.run)).rejects.toThrow('Packing incomplet');
  expect(blocked.order().status).toBe('preparing');
});
test('concurrent CAS losers cannot duplicate notification', async () => {
  const db = fakeService(); const spy = effects(); const before = db.order();
  const results = await Promise.allSettled([applyShipmentSnapshot(db.service, before, snapshot('IN_TRANSIT'), spy.run), applyShipmentSnapshot(db.service, before, snapshot('IN_TRANSIT'), spy.run)]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(spy.messages).toHaveLength(1);
});
test('unsupported providers retain manual transitions and pickup is unchanged', async () => {
  expect(managedShippingProviderInfo('flat_rate')).toBeNull(); expect(managedShippingProviderInfo('future-provider')).toBeNull();
  const db = fakeService(); const spy = effects();
  await updateWorkflowOrder({ service: db.service, order: db.order(), nextStatus: 'shipped', patch: { tracking_code: 'manual' }, sideEffects: spy.run });
  expect(db.order().tracking_code).toBe('manual');
  const pickup = fakeService(initialOrder({ fulfillment_type: 'pickup' }));
  await updateWorkflowOrder({ service: pickup.service, order: pickup.order(), nextStatus: 'ready_for_pickup', sideEffects: spy.run });
  expect(pickup.order().status).toBe('ready_for_pickup');
  await expect(applyShipmentSnapshot(pickup.service, pickup.order(), snapshot('IN_TRANSIT'), spy.run)).rejects.toThrow('suivi automatique');
  expect(pickup.order().status).toBe('ready_for_pickup');
});
test('tenant-scoped reads reject foreign order and use tenant credentials', async () => {
  const db = fakeService();
  await expect(loadWorkflowOrder(db.service, 'tenant-b', 'order-a')).rejects.toThrow('introuvable');
  let credential: string | null | undefined;
  await syncOrderShipment(db.service, 'tenant-a', 'order-a', reference, () => ({ ...packlinkAdapter, async resolveShipment(context) {
    credential = context.tenant.packlink_api_key as string | null; return snapshot('READY_FOR_COLLECTION');
  } }));
  expect(credential).toBe('tenant-a-test-key');
  expect(db.order().shipping_provider_reference).toBe(reference);
});
test('invalid reference never associates or updates order', async () => {
  const db = fakeService(); const before = db.order();
  await expect(syncOrderShipment(db.service, 'tenant-a', 'order-a', '../invalid')).rejects.toThrow('shipment_reference_invalid');
  expect(db.order()).toEqual(before);
  expect(() => parsePacklinkShipment(reference, { error: 'invalid' }, [])).toThrow('shipment_payload_invalid');
});
test('managed tracking rejects silent manual overrides; explicit fallback stops sync', async () => {
  const db = fakeService(initialOrder({ shipping_tracking_mode: 'managed', shipping_provider_reference: reference }));
  await expect(updateWorkflowOrder({ service: db.service, order: db.order(), patch: { tracking_code: 'override' } })).rejects.toThrow('automatiquement');
  await updateWorkflowOrder({ service: db.service, order: db.order(), source: 'manual_fallback', patch: { shipping_tracking_mode: 'manual', shipping_provider_reference: null } });
  await expect(syncOrderShipment(db.service, 'tenant-a', 'order-a')).rejects.toThrow('Aucune expédition');
});
test('unknown, exception and returned states never invent order transitions', async () => {
  const db = fakeService(); const spy = effects();
  for (const status of ['UNRECOGNIZED', 'EXCEPTION', 'RETURNED', 'CANCELLED']) await applyShipmentSnapshot(db.service, db.order(), snapshot(status), spy.run);
  expect(db.order().status).toBe('preparing'); expect(spy.messages).toHaveLength(0);
  expect(normalizePacklinkStatus('UNRECOGNIZED')).toBe('unknown');
});
test('admin endpoints are POST-only orders.manage and internal auth fails closed', () => {
  for (const action of ['attach', 'sync', 'manual']) {
    expect(permissionForAdminApi(`/api/admin/orders/id/shipment/${action}`, 'POST')).toBe('orders.manage');
    expect(permissionForAdminApi(`/api/admin/orders/id/shipment/${action}`, 'GET')).toBeNull();
  }
  expect(shippingSyncAuthorized(null, '')).toBe(false);
  expect(shippingSyncAuthorized('Bearer wrong', 'test')).toBe(false);
  expect(shippingSyncAuthorized('Bearer test', 'test')).toBe(true);
});
test('bounded scheduler excludes historical, terminal and unsupported shipments', async () => {
  const db = fakeService(initialOrder({ status: 'delivered', shipping_tracking_mode: 'managed', shipping_provider_reference: reference, shipping_provider_key: 'packlink' }));
  expect(await runShippingSyncBatch(db.service)).toEqual({ processed: 0, succeeded: 0, failed: 0 });
  expect(db.queries[0]).toBe('orders:id, tenant_id');
});

test('batch isolates failures, resolves tenant per order and enforces limit', async () => {
  const db = fakeService();
  db.rows.orders = Array.from({ length: 12 }, (_, index) => ({ ...initialOrder(), id: `order-${index}`,
    tenant_id: `tenant-${index}`, shipping_tracking_mode: 'managed', shipping_provider_key: 'packlink', shipping_provider_reference: `REF${index}` }));
  const calls: string[] = [];
  const result = await runShippingSyncBatch(db.service, async (_service, tenantId, orderId) => {
    calls.push(`${tenantId}:${orderId}`);
    if (orderId === 'order-0') throw new Error('test-failure');
    return initialOrder();
  });
  expect(result).toEqual({ processed: 6, succeeded: 5, failed: 1 });
  expect(calls).toEqual(Array.from({ length: 6 }, (_, index) => `tenant-${index}:order-${index}`));
});

test('provider HTTP not-found cannot associate; sync failure preserves last snapshot', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 404 });
  try {
    const db = fakeService();
    await expect(syncOrderShipment(db.service, 'tenant-a', 'order-a', reference)).rejects.toThrow('shipment_not_found');
    expect(db.order().shipping_provider_reference).toBeNull();
    const attached = fakeService(initialOrder({ shipping_tracking_mode: 'managed', shipping_provider_key: 'packlink',
      shipping_provider_reference: reference, tracking_code: 'old', shipping_provider_status: 'IN_TRANSIT' }));
    await expect(syncOrderShipment(attached.service, 'tenant-a', 'order-a')).rejects.toThrow('shipment_not_found');
    expect(attached.order().tracking_code).toBe('old');
    expect(attached.order().shipping_provider_status).toBe('IN_TRANSIT');
    expect(attached.order().shipping_sync_error).toBe('shipment_not_found');
    expect(attached.order().shipping_provider_synced_at).toBeTruthy();
  } finally { globalThis.fetch = originalFetch; }
});
