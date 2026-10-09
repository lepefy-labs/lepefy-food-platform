import { expect, test } from '@playwright/test';
import type { Order } from '@lepefy/types';
import {
  buildPacklinkDraftPayload, classifyPacklinkDraftStatus, packlinkAdapter, selectPacklinkWarehouse,
} from '../../src/lib/shipping/providers/packlink';
import { getShippingProvider } from '../../src/lib/shipping/providers/registry';
import type { ShippingProviderAdapter } from '../../src/lib/shipping/providers/types';
import {
  buildShipmentDraftInput, orderContactPhone, resolveOrderWeightG, shipmentOrderReference, splitRecipientName,
} from '../../src/lib/shipping/shipmentDraft/buildDraftInput';
import { resolveShippingAutomationSettings, type ShippingAutomationSettings } from '../../src/lib/shipping/shipmentDraft/settings';
import {
  createShipmentDraftForOrder, linkShipmentDraftReference, MAX_AUTOMATIC_ATTEMPTS, requestShipmentDraft, runShipmentDraftBatch,
  STALE_CREATING_MS, type ShipmentDraftDependencies,
} from '../../src/lib/shipping/shipmentDraft/shipmentDraftService';
import { shipmentDraftErrorMessage } from '../../src/lib/shipping/shipmentDraft/shipmentDraftPresentation';
import { syncOrderShipment } from '../../src/lib/shipping/syncOrderShipment';
import { updateWorkflowOrder, type OrderService } from '../../src/lib/orders/orderTransitionService';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

const ORDER_ID = '3f2a91c0-0000-4000-8000-000000000001';
const baseOrder = (patch: Partial<Order> = {}): Order => ({
  id: ORDER_ID, tenant_id: 'tenant-a', status: 'preparing', fulfillment_type: 'delivery',
  email: 'client@example.invalid', full_name: 'Awa Marie Diallo',
  shipping_address: { full_name: 'Awa Marie Diallo', line1: 'Via Roma 1', city: 'Reggio Emilia', postal_code: '42121', country: 'IT' },
  shipping_details: { totalWeightG: 12_500 }, subtotal: 84.5, shipping_cost: 14.9, total: 99.4,
  notes: 'Téléphone: +39 333 123 4567', tracking_code: null, tracking_carrier: null, shipped_at: null,
  shipping_tracking_mode: null, shipping_provider_key: null, shipping_provider_reference: null,
  shipping_creation_status: null, shipping_creation_attempts: 0, shipping_creation_error: null,
  shipping_creation_updated_at: null, shipping_provider_created_at: null,
  picking_started_at: null, picking_completed_at: null, packing_started_at: null, packing_completed_at: null,
  packing_parcel_count: null, cold_chain_packing_checked_at: null, updated_at: 'v0', created_at: '2026-10-09T08:00:00Z',
  ...patch,
} as Order);

type Row = Record<string, unknown>;
/** Fluent fake applying the same filters/CAS as PostgREST, lazily at await time; no network. */
function fakeDb(order: Order = baseOrder(), tenantPatch: Row = {}, extra: Partial<Record<string, Row[]>> = {}) {
  const rows: Record<string, Row[]> = {
    orders: [{ ...order }],
    tenants: [{ id: 'tenant-a', shipping_provider: 'packlink', packlink_api_key: 'tenant-a-test-key', currency: 'EUR', ...tenantPatch },
      { id: 'tenant-b', shipping_provider: 'packlink', packlink_api_key: 'tenant-b-test-key', currency: 'EUR' }],
    order_items: [
      { order_id: ORDER_ID, tenant_id: 'tenant-a', product_id: 'p1', name: 'Attiéké', quantity: 10, storage_type: 'dry', picked_at: 'x', cold_chain_checked_at: null },
      { order_id: ORDER_ID, tenant_id: 'tenant-a', product_id: 'p2', name: 'Foufou', quantity: 5, storage_type: 'dry', picked_at: 'x', cold_chain_checked_at: null },
    ],
    products: [{ id: 'p1', tenant_id: 'tenant-a', weight_grams: 1000 }, { id: 'p2', tenant_id: 'tenant-a', weight_grams: 500 }],
    packaging_surcharges: [{ tenant_id: 'tenant-a', active: true, max_pack_kg: 10, box_length_cm: 40, box_width_cm: 30, box_height_cm: 30 }],
    ...extra,
  };
  let revision = 0;
  const updates: Row[] = [];
  const raw = {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let patch: Row | undefined;
      let limit = Infinity;
      const query = {
        select(_columns?: string) { return query; },
        eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
        is(key: string, _value: null) { filters.push(row => row[key] == null); return query; },
        in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
        lt(key: string, value: string | number) { filters.push(row => row[key] != null && (row[key] as string | number) < value); return query; },
        not(key: string, _op: string, _value: unknown) { filters.push(row => row[key] != null); return query; },
        or(_filter: string) { return query; },
        order(_key: string, _options?: unknown) { return query; },
        limit(value: number) { limit = value; return query; },
        update(value: Row) { patch = value; return query; },
        async maybeSingle() { const result = execute(); return { data: result.data[0] ?? null, error: null }; },
        async single() { const result = execute(); return { data: result.data[0] ?? null, error: null }; },
        then(resolve: (value: { data: Row[]; error: null }) => unknown, reject?: (error: unknown) => unknown) {
          return Promise.resolve().then(execute).then(resolve, reject);
        },
      };
      function execute() {
        const matches = (rows[table] ?? []).filter(row => filters.every(filter => filter(row))).slice(0, limit);
        if (patch) {
          for (const row of matches) Object.assign(row, patch, { updated_at: `v${++revision}` });
          if (matches.length) updates.push({ table, ...patch });
        }
        return { data: matches.map(row => ({ ...row })), error: null };
      }
      return query;
    },
  };
  return { service: raw as unknown as OrderService, rows, updates, order: () => ({ ...rows.orders![0] }) as unknown as Order };
}

const settings = (patch: Partial<ShippingAutomationSettings> = {}): ShippingAutomationSettings =>
  ({ enabled: true, trigger: 'preparing', available: true, status: 'ok', ...patch });
const deps = (patch: Partial<ShippingAutomationSettings> = {}, adapterLookup: ShipmentDraftDependencies['adapterLookup'] = getShippingProvider,
  now = new Date('2026-10-09T10:00:00Z')): ShipmentDraftDependencies =>
  ({ adapterLookup, readSettings: async () => settings(patch), now: () => now });

const WAREHOUSES = [
  { id: 'w0', alias: 'Ancien', name: 'Old', address: 'Via Vecchia 9', postal_code: '00100', city: 'Roma', country: 'IT', default_selection: false },
  { id: 'w1', alias: 'Dépôt', name: 'Chloé', surname: 'Food', company: 'Chloe Food', address: 'Via Emilia 10',
    postal_code: '42122 - Reggio Emilia', country: 'IT', phone: '+39 0522 000000', email: 'depot@example.invalid', default_selection: true },
];
type DraftReply = { status: number; body?: unknown } | 'timeout' | 'network';
/** Stubs global fetch for the Packlink API only; any other host fails the test (no email, no network). */
function packlink(reply: DraftReply = { status: 200, body: { reference: 'IT2026PRO0006415025' } }) {
  const calls: { method: string; url: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get('authorization') });
    await new Promise(resolve => setTimeout(resolve, 1));
    if (!url.startsWith('https://api.packlink.com/v1/')) throw new Error('unexpected host ' + url);
    if (url.endsWith('/clients/warehouses')) return new Response(JSON.stringify(WAREHOUSES), { status: 200 });
    if (url.endsWith('/shipments') && method === 'POST') {
      if (reply === 'timeout') throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      if (reply === 'network') throw new TypeError('fetch failed');
      return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), { status: reply.status });
    }
    if (/\/shipments\/[A-Z0-9]+(\/track)?$/.test(url)) {
      return new Response(JSON.stringify(url.endsWith('/track') ? [] : { reference: url.split('/').pop(), state: 'READY_TO_PURCHASE' }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return {
    calls,
    posts: () => calls.filter(call => call.method === 'POST'),
    restore: () => { globalThis.fetch = original; },
  };
}

let api: ReturnType<typeof packlink> | null = null;
const mock = (reply?: DraftReply) => (api = packlink(reply));
test.afterEach(() => { api?.restore(); api = null; });

// ─── Pure building blocks ──────────────────────────────────────────────────────
test('payload: default warehouse as sender, recipient, quote parcel rule, no service (draft only)', () => {
  const built = buildShipmentDraftInput({ order: baseOrder(), items: [{ product_id: 'p1', name: 'Attiéké', quantity: 10 }],
    productWeights: new Map(), packaging: { max_pack_kg: 10, box_length_cm: 40, box_width_cm: 30, box_height_cm: 30 }, currency: 'EUR' });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  // Same split as calculateShipping.splitIntoParcels: 12.5 kg / 10 kg → 2 equal parcels.
  expect(built.input.parcels).toEqual([
    { weightKg: 6.25, lengthCm: 40, widthCm: 30, heightCm: 30 }, { weightKg: 6.25, lengthCm: 40, widthCm: 30, heightCm: 30 },
  ]);
  const warehouse = selectPacklinkWarehouse(WAREHOUSES)!;
  expect(warehouse).toMatchObject({ street1: 'Via Emilia 10', zip_code: '42122', city: 'Reggio Emilia', country: 'IT' });
  const payload = buildPacklinkDraftPayload(warehouse, built.input);
  expect(payload).not.toHaveProperty('service_id');
  expect(payload).toMatchObject({
    shipment_custom_reference: 'LEPEFY-3F2A91C0', contentvalue: 84.5, contentValue_currency: 'EUR',
    to: { name: 'Awa Marie', surname: 'Diallo', street1: 'Via Roma 1', zip_code: '42121', city: 'Reggio Emilia', country: 'IT', phone: '+39 333 123 4567' },
    packages: [{ weight: 6.25, width: 30, height: 30, length: 40 }, { weight: 6.25, width: 30, height: 30, length: 40 }],
  });
  // The customer shipping price is never part of the draft.
  expect(JSON.stringify(payload)).not.toContain('14.9');
  expect(selectPacklinkWarehouse([WAREHOUSES[0], { ...WAREHOUSES[0], id: 'w2' }])).toBeNull();
});

test('helpers: reference, phone from notes, name split, weight fallback without invented weights', () => {
  expect(shipmentOrderReference(ORDER_ID)).toBe('LEPEFY-3F2A91C0');
  expect(orderContactPhone('Téléphone: 06 12 34 56 78')).toBe('06 12 34 56 78');
  expect(orderContactPhone('Note libre\nTéléphone:  +33 6 12 34 56 78 ')).toBe('+33 6 12 34 56 78');
  expect(orderContactPhone('Téléphone: 12')).toBeNull();
  expect(orderContactPhone(null)).toBeNull();
  expect(splitRecipientName('Awa')).toEqual({ firstName: 'Awa', lastName: null });
  const order = baseOrder({ shipping_details: null });
  const items = [{ product_id: 'p1', name: 'A', quantity: 2 }, { product_id: 'p2', name: 'B', quantity: 1 }];
  expect(resolveOrderWeightG(order, items, new Map([['p1', 1000], ['p2', 500]]))).toBe(2500);
  expect(resolveOrderWeightG(order, items, new Map([['p1', 1000], ['p2', null]]))).toBeNull();
  expect(resolveOrderWeightG(baseOrder(), items, new Map())).toBe(12_500);
});

test('Packlink HTTP classification: only 429/503 are retryable, other 5xx are ambiguous', () => {
  expect(classifyPacklinkDraftStatus(400)).toBe('provider_rejected');
  expect(classifyPacklinkDraftStatus(422)).toBe('provider_rejected');
  expect(classifyPacklinkDraftStatus(401)).toBe('missing_configuration');
  expect(classifyPacklinkDraftStatus(429)).toBe('provider_unavailable');
  expect(classifyPacklinkDraftStatus(503)).toBe('provider_unavailable');
  for (const status of [500, 502, 504]) expect(classifyPacklinkDraftStatus(status)).toBe('ambiguous_creation');
  expect(packlinkAdapter.capabilities.createDraft).toBe(true);
});

test('22. existing tenants: no row means disabled, manual only', () => {
  expect(resolveShippingAutomationSettings(null)).toMatchObject({ enabled: false, trigger: 'manual' });
  expect(resolveShippingAutomationSettings({ enabled: true, config: { create_shipment_trigger: 'soon' } })).toMatchObject({ enabled: false });
  expect(resolveShippingAutomationSettings({ enabled: true, config: { version: 1, create_shipment_trigger: 'order_created' } }))
    .toMatchObject({ enabled: true, trigger: 'order_created' });
});

test('RBAC: draft creation is orders.manage, the setting is shipping.view / shipping.manage', () => {
  expect(permissionForAdminApi(`/api/admin/orders/${ORDER_ID}/shipment/create`, 'POST')).toBe('orders.manage');
  expect(permissionForAdminApi(`/api/admin/orders/${ORDER_ID}/shipment/create`, 'GET')).toBeNull();
  expect(permissionForAdminApi('/api/admin/shipping-automation', 'GET')).toBe('shipping.view');
  expect(permissionForAdminApi('/api/admin/shipping-automation', 'PATCH')).toBe('shipping.manage');
});

test('error messages are readable and never echo provider payloads', () => {
  expect(shipmentDraftErrorMessage('invalid_recipient:téléphone')).toBe('Coordonnées du destinataire incomplètes (manquant : téléphone).');
  expect(shipmentDraftErrorMessage('invalid_parcel:dimensions')).toContain('Emballages');
  expect(shipmentDraftErrorMessage(null)).toBeNull();
});

// ─── Eligibility and triggers ─────────────────────────────────────────────────
test('1-4. disabled, other provider, pickup and manual trigger never call the provider', async () => {
  const http = mock();
  const disabled = fakeDb();
  expect(await requestShipmentDraft(disabled.service, 'tenant-a', ORDER_ID, 'preparation_started', deps({ enabled: false }))).toBe('skipped');
  expect(await createShipmentDraftForOrder(disabled.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps({ enabled: false })))
    .toEqual({ outcome: 'skipped', reason: 'disabled' });

  const flat = fakeDb(baseOrder(), { shipping_provider: 'flat_rate' });
  expect(await requestShipmentDraft(flat.service, 'tenant-a', ORDER_ID, 'preparation_started', deps())).toBe('skipped');
  expect(await createShipmentDraftForOrder(flat.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps()))
    .toEqual({ outcome: 'skipped', reason: 'provider_unsupported' });

  const pickup = fakeDb(baseOrder({ fulfillment_type: 'pickup' }));
  expect(await requestShipmentDraft(pickup.service, 'tenant-a', ORDER_ID, 'order_created', deps({ trigger: 'order_created' }))).toBe('skipped');
  expect(await createShipmentDraftForOrder(pickup.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps()))
    .toEqual({ outcome: 'skipped', reason: 'not_delivery' });

  const manual = fakeDb();
  for (const event of ['order_created', 'preparation_started'] as const) {
    expect(await requestShipmentDraft(manual.service, 'tenant-a', ORDER_ID, event, deps({ trigger: 'manual' }))).toBe('skipped');
  }
  expect(await runShipmentDraftBatch(manual.service, deps({ trigger: 'manual' }))).toMatchObject({ processed: 0 });
  for (const db of [disabled, flat, pickup, manual]) expect(db.order().shipping_creation_status).toBeNull();
  expect(http.calls).toHaveLength(0);
});

test('5. order_created: queued on creation, created by the tick, reference saved as managed', async () => {
  const http = mock();
  const db = fakeDb();
  const d = deps({ trigger: 'order_created' });
  expect(await requestShipmentDraft(db.service, 'tenant-a', ORDER_ID, 'preparation_started', d)).toBe('skipped');
  expect(await requestShipmentDraft(db.service, 'tenant-a', ORDER_ID, 'order_created', d)).toBe('queued');
  expect(http.calls).toHaveLength(0); // the event never waits for Packlink
  expect(db.order().shipping_creation_status).toBe('pending');
  expect(await runShipmentDraftBatch(db.service, d)).toMatchObject({ processed: 1, created: 1 });
  expect(http.posts()).toHaveLength(1);
  expect(http.calls.every(call => call.auth === 'tenant-a-test-key')).toBe(true);
  // 19/21. Reference stored, order untouched (still preparing, not shipped, same prices, no e-mail call).
  expect(db.order()).toMatchObject({
    status: 'preparing', shipped_at: null, shipping_cost: 14.9, total: 99.4,
    shipping_creation_status: 'draft_created', shipping_creation_attempts: 1, shipping_creation_error: null,
    shipping_tracking_mode: 'managed', shipping_provider_key: 'packlink', shipping_provider_reference: 'IT2026PRO0006415025',
    shipping_normalized_status: 'pending', shipping_provider_created_at: expect.any(String),
  });
  expect(http.calls.every(call => call.url.startsWith('https://api.packlink.com/'))).toBe(true);
});

test('6. preparing: queued only when preparation starts (new → preparing), never on preparing → preparing', async () => {
  const db = fakeDb(baseOrder({ status: 'new' }));
  const started: string[] = [];
  const onPreparationStarted = async (service: OrderService, tenantId: string, orderId: string) => {
    started.push(orderId);
    return requestShipmentDraft(service, tenantId, orderId, 'preparation_started', deps());
  };
  const noEffects = async () => undefined;
  await updateWorkflowOrder({ service: db.service, order: db.order(), nextStatus: 'preparing', sideEffects: noEffects, onPreparationStarted });
  expect(started).toEqual([ORDER_ID]);
  expect(db.order()).toMatchObject({ status: 'preparing', shipping_creation_status: 'pending' });
  await updateWorkflowOrder({ service: db.service, order: db.order(), nextStatus: 'preparing', patch: { notes: 'x' }, sideEffects: noEffects, onPreparationStarted });
  expect(started).toHaveLength(1);
  // A second « preparation started » signal (e.g. picking) does not re-queue.
  expect(await requestShipmentDraft(db.service, 'tenant-a', ORDER_ID, 'preparation_started', deps())).toBe('skipped');
});

test('7. an existing reference is never replaced and never posted again', async () => {
  const http = mock();
  const db = fakeDb(baseOrder({ shipping_provider_reference: 'IT2026PRO0000000001', shipping_tracking_mode: 'managed', shipping_provider_key: 'packlink' }));
  expect(await requestShipmentDraft(db.service, 'tenant-a', ORDER_ID, 'preparation_started', deps())).toBe('skipped');
  expect(await createShipmentDraftForOrder(db.service, 'tenant-a', ORDER_ID, { mode: 'manual', confirmNoExistingDraft: true }, deps()))
    .toEqual({ outcome: 'skipped', reason: 'existing_reference' });
  expect(http.calls).toHaveLength(0);
  expect(db.order().shipping_provider_reference).toBe('IT2026PRO0000000001');
});

test('8/24. manual click creates the draft whatever the trigger', async () => {
  const http = mock();
  const db = fakeDb();
  expect(await createShipmentDraftForOrder(db.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps({ trigger: 'manual' })))
    .toEqual({ outcome: 'created', reference: 'IT2026PRO0006415025' });
  expect(http.posts()).toHaveLength(1);
  expect(await createShipmentDraftForOrder(db.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps()))
    .toEqual({ outcome: 'skipped', reason: 'existing_reference' });
  expect(http.posts()).toHaveLength(1);
});

test('9. double click / concurrent workers: at most one provider creation', async () => {
  const http = mock();
  const db = fakeDb(baseOrder({ shipping_creation_status: 'pending' }));
  const results = await Promise.all([
    createShipmentDraftForOrder(db.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps()),
    createShipmentDraftForOrder(db.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps()),
    runShipmentDraftBatch(db.service, deps()),
  ]);
  expect(http.posts()).toHaveLength(1);
  expect(results.filter(result => 'outcome' in result && result.outcome === 'created')
    .length + ((results[2] as { created: number }).created)).toBe(1);
  expect(db.order().shipping_creation_attempts).toBe(1);
});

// ─── Provider failures ────────────────────────────────────────────────────────
test('10. Packlink 4xx: failed, not retried automatically, retry allowed manually', async () => {
  mock({ status: 422, body: { messages: [{ message: 'to.zip_code invalid for Awa Diallo' }] } });
  const db = fakeDb(baseOrder({ shipping_creation_status: 'pending' }));
  expect(await runShipmentDraftBatch(db.service, deps())).toMatchObject({ failed: 1 });
  expect(db.order()).toMatchObject({ shipping_creation_status: 'failed', shipping_creation_error: 'provider_rejected', shipping_provider_reference: null });
  expect(JSON.stringify(db.order())).not.toContain('Awa Diallo"'); // raw provider message never stored
  expect(await runShipmentDraftBatch(db.service, deps(undefined, undefined, new Date('2026-10-10T10:00:00Z')))).toMatchObject({ processed: 0 });
  api!.restore(); mock();
  expect((await createShipmentDraftForOrder(db.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps())).outcome).toBe('created');
});

test('11. Packlink 503 is retried by the tick up to the attempt limit; other 5xx are ambiguous', async () => {
  const http = mock({ status: 503 });
  const db = fakeDb(baseOrder({ shipping_creation_status: 'pending' }));
  let now = new Date('2026-10-09T10:00:00Z');
  for (let tick = 0; tick < MAX_AUTOMATIC_ATTEMPTS + 2; tick++) {
    await runShipmentDraftBatch(db.service, deps(undefined, undefined, now));
    now = new Date(now.getTime() + 15 * 60_000);
  }
  expect(http.posts()).toHaveLength(MAX_AUTOMATIC_ATTEMPTS);
  expect(db.order()).toMatchObject({ shipping_creation_status: 'failed', shipping_creation_error: 'provider_unavailable', shipping_creation_attempts: MAX_AUTOMATIC_ATTEMPTS });

  api!.restore(); const server = mock({ status: 500 });
  const other = fakeDb(baseOrder({ shipping_creation_status: 'pending' }));
  await runShipmentDraftBatch(other.service, deps());
  expect(other.order()).toMatchObject({ shipping_creation_status: 'ambiguous', shipping_creation_error: 'ambiguous_creation' });
  await runShipmentDraftBatch(other.service, deps(undefined, undefined, new Date('2026-10-10T10:00:00Z')));
  expect(server.posts()).toHaveLength(1);
});

test('12/25. timeout: ambiguous, never retried blindly, recreate needs explicit confirmation', async () => {
  const http = mock('timeout');
  const db = fakeDb(baseOrder({ shipping_creation_status: 'pending' }));
  await runShipmentDraftBatch(db.service, deps());
  expect(db.order()).toMatchObject({ shipping_creation_status: 'ambiguous', shipping_creation_error: 'provider_timeout' });
  await runShipmentDraftBatch(db.service, deps(undefined, undefined, new Date('2026-10-10T10:00:00Z')));
  expect(await createShipmentDraftForOrder(db.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps()))
    .toEqual({ outcome: 'skipped', reason: 'requires_confirmation' });
  expect(http.posts()).toHaveLength(1);
  api!.restore(); const retry = mock();
  expect((await createShipmentDraftForOrder(db.service, 'tenant-a', ORDER_ID, { mode: 'manual', confirmNoExistingDraft: true }, deps())).outcome).toBe('created');
  expect(retry.posts()).toHaveLength(1);
});

test('25. ambiguous reconciliation: link the reference found in Packlink PRO after verification', async () => {
  const http = mock('network');
  const db = fakeDb(baseOrder({ shipping_creation_status: 'pending' }));
  await runShipmentDraftBatch(db.service, deps());
  expect(db.order().shipping_creation_status).toBe('ambiguous');
  api!.restore(); mock();
  expect(await linkShipmentDraftReference(db.service, 'tenant-a', ORDER_ID, 'it2026pro0006415025', deps()))
    .toEqual({ outcome: 'created', reference: 'IT2026PRO0006415025' });
  expect(db.order()).toMatchObject({ shipping_creation_status: 'draft_created', shipping_provider_reference: 'IT2026PRO0006415025', shipping_tracking_mode: 'managed' });
  expect(http.posts()).toHaveLength(1);
});

test('25. interrupted claim (creating for too long) becomes ambiguous, never recreated by the tick', async () => {
  const http = mock();
  const claimedAt = '2026-10-09T09:00:00.000Z';
  const db = fakeDb(baseOrder({ shipping_creation_status: 'creating', shipping_creation_attempts: 1, shipping_creation_updated_at: claimedAt }));
  const now = new Date(Date.parse(claimedAt) + STALE_CREATING_MS + 1000);
  expect(await runShipmentDraftBatch(db.service, deps(undefined, undefined, now))).toMatchObject({ ambiguous: 1, processed: 0 });
  expect(db.order()).toMatchObject({ shipping_creation_status: 'ambiguous', shipping_creation_error: 'ambiguous_creation:interrompu' });
  expect(http.calls).toHaveLength(0);
  expect(await createShipmentDraftForOrder(fakeDb(baseOrder({ shipping_creation_status: 'creating' })).service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps()))
    .toEqual({ outcome: 'busy' });
});

test('13. 2xx without a reference is an ambiguous, unretried creation', async () => {
  const http = mock({ status: 201, body: { ok: true } });
  const db = fakeDb(baseOrder({ shipping_creation_status: 'pending' }));
  await runShipmentDraftBatch(db.service, deps());
  expect(db.order()).toMatchObject({ shipping_creation_status: 'ambiguous', shipping_creation_error: 'invalid_provider_response', shipping_provider_reference: null });
  await runShipmentDraftBatch(db.service, deps(undefined, undefined, new Date('2026-10-10T10:00:00Z')));
  expect(http.posts()).toHaveLength(1);
});

test('14-16. incomplete address, missing weight or box size: explicit error, Packlink not called', async () => {
  const http = mock();
  const noPhone = fakeDb(baseOrder({ notes: null, shipping_creation_status: 'pending' }));
  await createShipmentDraftForOrder(noPhone.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps());
  expect(noPhone.order()).toMatchObject({ shipping_creation_status: 'failed', shipping_creation_error: 'invalid_recipient:téléphone' });

  const noAddress = fakeDb(baseOrder({ shipping_address: null, full_name: null }));
  await createShipmentDraftForOrder(noAddress.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps());
  expect(noAddress.order().shipping_creation_error).toBe('invalid_recipient:nom, adresse, code postal, ville, pays');

  const noWeight = fakeDb(baseOrder({ shipping_details: null }), {}, { products: [{ id: 'p1', tenant_id: 'tenant-a', weight_grams: 1000 }, { id: 'p2', tenant_id: 'tenant-a', weight_grams: null }] });
  await createShipmentDraftForOrder(noWeight.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps());
  expect(noWeight.order().shipping_creation_error).toBe('invalid_parcel:poids');

  const noBox = fakeDb(baseOrder(), {}, { packaging_surcharges: [] });
  await createShipmentDraftForOrder(noBox.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps());
  expect(noBox.order().shipping_creation_error).toBe('invalid_parcel:dimensions');

  for (const db of [noPhone, noAddress, noWeight, noBox]) expect(db.order().shipping_creation_status).toBe('failed');
  // Not retryable automatically.
  expect(await runShipmentDraftBatch(noPhone.service, deps(undefined, undefined, new Date('2026-10-10T10:00:00Z')))).toMatchObject({ processed: 0 });
  expect(http.calls).toHaveLength(0);
});

test('missing Packlink key or default warehouse: missing_configuration before any draft POST', async () => {
  const http = mock();
  const noKey = fakeDb(baseOrder(), { packlink_api_key: null, is_test: true });
  await createShipmentDraftForOrder(noKey.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps());
  expect(noKey.order()).toMatchObject({ shipping_creation_status: 'failed', shipping_creation_error: 'missing_configuration' });
  expect(http.calls).toHaveLength(0);
});

test('17/18. a broken draft queue never fails order creation or the preparing transition', async () => {
  const broken = { from() { throw new Error('relation missing'); } } as unknown as OrderService;
  await expect(requestShipmentDraft(broken, 'tenant-a', ORDER_ID, 'order_created', deps({ trigger: 'order_created' }))).resolves.toBe('skipped');
  const db = fakeDb(baseOrder({ status: 'new' }));
  const failing = deps();
  failing.readSettings = async () => { throw new Error('settings unavailable'); };
  const saved = await updateWorkflowOrder({ service: db.service, order: db.order(), nextStatus: 'preparing', sideEffects: async () => undefined,
    onPreparationStarted: (service, tenantId, orderId) => requestShipmentDraft(service, tenantId, orderId, 'preparation_started', failing) });
  expect(saved.status).toBe('preparing');
});

test('20. the managed tracking sync reuses the stored draft reference', async () => {
  mock();
  const db = fakeDb(baseOrder({ picking_started_at: 'x', packing_completed_at: 'x', packing_parcel_count: 1 }));
  await createShipmentDraftForOrder(db.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps());
  const resolved: string[] = [];
  const adapter: ShippingProviderAdapter = { ...packlinkAdapter, async resolveShipment(_context, reference) {
    resolved.push(reference);
    return { provider: 'packlink', providerReference: reference, carrier: null, trackingCode: null, trackingUrl: null,
      estimatedDeliveryAt: null, providerStatus: 'READY_TO_PURCHASE', normalizedStatus: 'pending', events: [] };
  } };
  const synced = await syncOrderShipment(db.service, 'tenant-a', ORDER_ID, undefined, () => adapter);
  expect(resolved).toEqual(['IT2026PRO0006415025']);
  expect(synced.status).toBe('preparing');
});

test('23. tenant isolation: another tenant cannot create, link or queue the order', async () => {
  const http = mock();
  const db = fakeDb();
  expect(await createShipmentDraftForOrder(db.service, 'tenant-b', ORDER_ID, { mode: 'manual' }, deps()))
    .toEqual({ outcome: 'skipped', reason: 'order_inactive' });
  expect(await linkShipmentDraftReference(db.service, 'tenant-b', ORDER_ID, 'IT2026PRO0006415025', deps()))
    .toEqual({ outcome: 'skipped', reason: 'order_inactive' });
  expect(await requestShipmentDraft(db.service, 'tenant-b', ORDER_ID, 'preparation_started', deps())).toBe('skipped');
  expect(http.calls).toHaveLength(0);
  expect(db.updates).toHaveLength(0);
});
