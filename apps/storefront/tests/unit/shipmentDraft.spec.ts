import { expect, test } from '@playwright/test';
import type { Order } from '@lepefy/types';
import {
  buildPacklinkDraftPayload, classifyPacklinkDraftStatus, packlinkAdapter, packlinkPostalZoneName, selectPacklinkPostalCode,
  selectPacklinkWarehouse,
} from '../../src/lib/shipping/providers/packlink';
import { getShippingProvider } from '../../src/lib/shipping/providers/registry';
import { ShippingProviderError, type ShippingProviderAdapter } from '../../src/lib/shipping/providers/types';
import {
  buildShipmentDraftInput, orderContactPhone, resolveOrderWeightG, shipmentOrderReference, splitRecipientName,
} from '../../src/lib/shipping/shipmentDraft/buildDraftInput';
import { resolveShippingAutomationSettings, type ShippingAutomationSettings } from '../../src/lib/shipping/shipmentDraft/settings';
import {
  createShipmentDraftForOrder, linkShipmentDraftReference, MAX_AUTOMATIC_ATTEMPTS, releaseDeletedShipmentDraft, requestShipmentDraft, runShipmentDraftBatch,
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
/** Emballages profiles with suggestion ranges, as on the order « Carton à utiliser » card. */
const PROFILES = [
  { id: 'carton-s', name: 'Carton S', box_length_cm: 30, box_width_cm: 20, box_height_cm: 15, active: true, position: 1, is_default: false,
    suggest_min_weight_g: 0, suggest_max_weight_g: 5000, tare_g: 300 },
  { id: 'carton-m', name: 'Carton M', box_length_cm: 40, box_width_cm: 30, box_height_cm: 30, active: true, position: 2, is_default: true,
    suggest_min_weight_g: 5000, suggest_max_weight_g: 10000, tare_g: 500 },
];
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
    shipping_packaging_profiles: PROFILES.map(profile => ({ ...profile, tenant_id: 'tenant-a' })),
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
  ({ enabled: true, trigger: 'preparing', content: 'Alimenti Non Deperibili', available: true, status: 'ok', ...patch });
const deps = (patch: Partial<ShippingAutomationSettings> = {}, adapterLookup: ShipmentDraftDependencies['adapterLookup'] = getShippingProvider,
  now = new Date('2026-10-09T10:00:00Z')): ShipmentDraftDependencies =>
  ({ adapterLookup, readSettings: async () => settings(patch), now: () => now });

const WAREHOUSES = [
  { id: 'w0', alias: 'Ancien', name: 'Old', address: 'Via Vecchia 9', postal_code: '00100', city: 'Roma', country: 'IT', default_selection: false },
  { id: 'w1', alias: 'Dépôt', name: 'Chloé', surname: 'Food', company: 'Chloe Food', address: 'Via Emilia 10',
    postal_code: '42122 - Reggio Emilia', country: 'IT', phone: '+39 0522 000000', email: 'depot@example.invalid', default_selection: true },
];
/** Shapes of GET locations/postalcodes/{country}/{zip} and locations/postalzones/destinations (observed 20/10/2026). */
const POSTAL_CODES: Record<string, unknown[]> = {
  'IT/42122': [{ id: 'zc-42122', zipcode: '42122', zipcodeCity: "42122 - Reggio nell'Emilia", postalZoneId: 113, city: { name: "Reggio nell'Emilia" } }],
  'IT/42121': [{ id: 'zc-42121', zipcode: '42121', zipcodeCity: "42121 - Reggio nell'Emilia", postalZoneId: 113, city: { name: "Reggio nell'Emilia" } }],
};
const POSTAL_ZONES = [{ id: '113', name: 'Italia', isoCode: 'IT' }, { id: '115', name: 'Sicilia- Italia', isoCode: 'IT' }, { id: '76', name: 'Francia', isoCode: 'FR' }];
type DraftReply = { status: number; body?: unknown } | 'timeout' | 'network';
/** Stubs global fetch for the Packlink API only; any other host fails the test (no email, no network). */
function packlink(reply: DraftReply = { status: 200, body: { reference: 'IT2026PRO0006415025' } }, lookups: 'ok' | 'down' = 'ok') {
  const calls: { method: string; url: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get('authorization') });
    await new Promise(resolve => setTimeout(resolve, 1));
    if (!url.startsWith('https://api.packlink.com/v1/')) throw new Error('unexpected host ' + url);
    if (url.endsWith('/clients/warehouses')) return new Response(JSON.stringify(WAREHOUSES), { status: 200 });
    if (url.includes('/v1/locations/')) {
      if (lookups === 'down') return new Response('{}', { status: 500 });
      if (url.includes('/locations/postalzones/destinations?')) return new Response(JSON.stringify(POSTAL_ZONES), { status: 200 });
      const codes = POSTAL_CODES[url.split('/locations/postalcodes/')[1] ?? ''];
      return new Response(JSON.stringify(codes ?? []), { status: 200 });
    }
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
const mock = (reply?: DraftReply, lookups?: 'ok' | 'down') => (api = packlink(reply, lookups));
test.afterEach(() => { api?.restore(); api = null; });

// ─── Pure building blocks ──────────────────────────────────────────────────────
const PACKAGING = { max_pack_kg: 10, box_length_cm: 40, box_width_cm: 30, box_height_cm: 20 };

test('payload: default warehouse as sender, suggested cartons with tare, declared content, no service (draft only)', () => {
  const built = buildShipmentDraftInput({ order: baseOrder(), items: [{ product_id: 'p1', name: 'Attiéké', quantity: 10 }],
    productWeights: new Map(), profiles: PROFILES, packaging: PACKAGING, content: 'Alimenti Non Deperibili', currency: 'EUR' });
  expect(built.ok).toBe(true);
  if (!built.ok) return;
  // Same plan as the order « Carton à utiliser » card: filled parcels 10 kg + 2.5 kg,
  // carton per parcel from its suggestion range, tare added to the gross weight.
  expect(built.input.parcels).toEqual([
    { weightKg: 10.5, lengthCm: 40, widthCm: 30, heightCm: 30 }, { weightKg: 2.8, lengthCm: 30, widthCm: 20, heightCm: 15 },
  ]);
  expect(built.input.content).toBe('Alimenti Non Deperibili');
  const warehouse = selectPacklinkWarehouse(WAREHOUSES)!;
  expect(warehouse).toMatchObject({ street1: 'Via Emilia 10', zip_code: '42122', city: 'Reggio Emilia', country: 'IT' });
  const payload = buildPacklinkDraftPayload(warehouse, built.input);
  expect(payload).not.toHaveProperty('service_id');
  expect(payload).toMatchObject({
    shipment_custom_reference: 'LEPEFY-3F2A91C0', contentvalue: 84.5, contentValue_currency: 'EUR', content: 'Alimenti Non Deperibili',
    to: { name: 'Awa Marie', surname: 'Diallo', street1: 'Via Roma 1', zip_code: '42121', city: 'Reggio Emilia', country: 'IT', phone: '+39 333 123 4567' },
    packages: [{ weight: 10.5, width: 30, height: 30, length: 40 }, { weight: 2.8, width: 20, height: 15, length: 30 }],
  });
  // The customer shipping price is never part of the draft.
  expect(JSON.stringify(payload)).not.toContain('14.9');
  expect(selectPacklinkWarehouse([WAREHOUSES[0], { ...WAREHOUSES[0], id: 'w2' }])).toBeNull();
});

test('parcels fall back to the default profile, then to the checkout box; empty content is refused', () => {
  const order = baseOrder({ shipping_details: { totalWeightG: 7000 } });
  const base = { order, items: [], productWeights: new Map<string, number | null>(), content: 'Alimenti Non Deperibili', currency: 'EUR' };
  // Weight outside every suggestion range → default profile (Carton M).
  const ranged = PROFILES.map(profile => ({ ...profile, suggest_max_weight_g: 1000, suggest_min_weight_g: 0 }));
  const fallback = buildShipmentDraftInput({ ...base, profiles: ranged, packaging: PACKAGING });
  expect(fallback.ok && fallback.input.parcels).toEqual([{ weightKg: 7.5, lengthCm: 40, widthCm: 30, heightCm: 30 }]);
  // No profiles at all → packaging_surcharges box, no tare.
  const box = buildShipmentDraftInput({ ...base, profiles: [], packaging: PACKAGING });
  expect(box.ok && box.input.parcels).toEqual([{ weightKg: 7, lengthCm: 40, widthCm: 30, heightCm: 20 }]);
  expect(buildShipmentDraftInput({ ...base, profiles: PROFILES, packaging: PACKAGING, content: '  ' }))
    .toMatchObject({ ok: false, code: 'invalid_parcel', detail: 'contenu' });
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
  expect(resolveShippingAutomationSettings(null)).toMatchObject({ enabled: false, trigger: 'manual', content: 'Alimenti Non Deperibili' });
  // A 151-era row (no shipment_content) keeps working with the default content.
  expect(resolveShippingAutomationSettings({ enabled: true, config: { version: 1, create_shipment_trigger: 'preparing' } }))
    .toMatchObject({ enabled: true, content: 'Alimenti Non Deperibili' });
  expect(resolveShippingAutomationSettings({ enabled: true, config: { create_shipment_trigger: 'manual', shipment_content: 'x'.repeat(61) } }))
    .toMatchObject({ enabled: false, status: 'invalid' });
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
  expect(http.posts()[0]!.body).toMatchObject({ content: 'Alimenti Non Deperibili', packages: [
    { weight: 10.5, width: 30, height: 30, length: 40 }, { weight: 2.8, width: 20, height: 15, length: 30 },
  ] });
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

  const noBox = fakeDb(baseOrder(), {}, { packaging_surcharges: [], shipping_packaging_profiles: [] });
  await createShipmentDraftForOrder(noBox.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps());
  expect(noBox.order().shipping_creation_error).toBe('invalid_parcel:dimensions');

  for (const db of [noPhone, noAddress, noWeight, noBox]) expect(db.order().shipping_creation_status).toBe('failed');
  // Not retryable automatically.
  expect(await runShipmentDraftBatch(noPhone.service, deps(undefined, undefined, new Date('2026-10-10T10:00:00Z')))).toMatchObject({ processed: 0 });
  expect(http.calls).toHaveLength(0);
});

// ─── Recipient CAP and Packlink PRO location (draft editor keeps the CAP) ───────
const draftFor = (address: Record<string, unknown>, weightG = 12_500) => buildShipmentDraftInput({
  order: baseOrder({ shipping_address: { full_name: 'Awa Marie Diallo', line1: 'Via Roma 1', ...address } as unknown as Order['shipping_address'],
    shipping_details: { totalWeightG: weightG } }),
  items: [], productWeights: new Map(), profiles: PROFILES, packaging: PACKAGING, content: 'Alimenti Non Deperibili', currency: 'EUR',
});

test('CAP: leading zeros and short codes survive as strings up to the serialized payload (IT, FR, BE, DE)', () => {
  const warehouse = selectPacklinkWarehouse(WAREHOUSES)!;
  for (const [country, zip, city] of [['IT', '00144', 'Roma'], ['IT', '42122', 'Reggio Emilia'], ['FR', '75001', 'Paris'], ['BE', '1000', 'Bruxelles'], ['DE', '01067', 'Dresden']]) {
    const built = draftFor({ postal_code: ` ${zip} `, city, country });
    expect(built.ok).toBe(true);
    if (!built.ok) continue;
    expect(built.input.recipient).toMatchObject({ postalCode: zip, city, country });
    const json = JSON.stringify(buildPacklinkDraftPayload(warehouse, built.input));
    expect(json).toContain(`"zip_code":"${zip}"`);
  }
});

test('CAP, city or country missing/invalid: controlled error before any provider call', () => {
  expect(draftFor({ city: 'Roma', country: 'IT' })).toMatchObject({ ok: false, code: 'invalid_recipient', detail: 'code postal' });
  expect(draftFor({ postal_code: '00144', country: 'IT' })).toMatchObject({ ok: false, code: 'invalid_recipient', detail: 'ville' });
  for (const country of ['', 'I', 'ITA', '1T']) {
    expect(draftFor({ postal_code: '00144', city: 'Roma', country })).toMatchObject({ ok: false, code: 'invalid_recipient', detail: 'pays' });
  }
});

test('changing the parcels never touches the recipient address in the Lepefy model', () => {
  const light = draftFor({ postal_code: '00144', city: 'Roma', country: 'IT' }, 2_000);
  const heavy = draftFor({ postal_code: '00144', city: 'Roma', country: 'IT' }, 27_000);
  expect(light.ok && heavy.ok).toBe(true);
  if (!light.ok || !heavy.ok) return;
  expect(heavy.input.parcels.length).toBeGreaterThan(light.input.parcels.length);
  expect(heavy.input.recipient).toEqual(light.input.recipient);
});

test('Packlink location: city disambiguates a shared CAP, a single record wins, ambiguity is never guessed', () => {
  const roma = [
    { id: 'acilia', zipcode: '00132', postalZoneId: 113, city: { name: 'Acilia-Castel Fusano-Ostia Antica' } },
    { id: 'roma', zipcode: '00132', postalZoneId: 113, city: { name: 'Roma' } },
  ];
  expect(selectPacklinkPostalCode(roma, '00132', ' ROMA ')).toEqual({ zipCodeId: 'roma', postalZoneId: '113' });
  expect(selectPacklinkPostalCode(roma, '00132', 'Ostia')).toBeNull();
  expect(selectPacklinkPostalCode(POSTAL_CODES['IT/42122'], '42122', 'Reggio Emilia')).toEqual({ zipCodeId: 'zc-42122', postalZoneId: '113' });
  expect(selectPacklinkPostalCode([{ id: 'x', zipcode: '00144', postalZoneId: 113, city: { name: 'Roma' } }], '144', 'Roma')).toBeNull();
  expect(selectPacklinkPostalCode({ messages: ['not found'] }, '00144', 'Roma')).toBeNull();
  expect(selectPacklinkPostalCode([{ id: 'x', zipcode: '00144', postalZoneId: 'Italia', city: { name: 'Roma' } }], '00144', 'Roma')).toBeNull();
  expect(packlinkPostalZoneName(POSTAL_ZONES, '113')).toBe('Italia');
  expect(packlinkPostalZoneName(POSTAL_ZONES, '999')).toBeNull();
});

test('payload with locations: additional_data and state as Packlink PRO stores them, warehouse id, zip_code kept', () => {
  const built = draftFor({ postal_code: '00144', city: 'Roma', country: 'IT' });
  if (!built.ok) throw new Error('draft input');
  const warehouse = selectPacklinkWarehouse(WAREHOUSES)!;
  expect(warehouse.id).toBe('w1');
  const payload = buildPacklinkDraftPayload(warehouse, built.input, {
    from: { zipCodeId: 'zc-42122', postalZoneId: '113', postalZoneName: 'Italia' },
    to: { zipCodeId: 'zc-00144', postalZoneId: '113', postalZoneName: 'Italia' },
  });
  expect(payload).toMatchObject({
    from: { zip_code: '42122', city: 'Reggio Emilia', country: 'IT', state: 'Italia' },
    to: { zip_code: '00144', city: 'Roma', country: 'IT', state: 'Italia' },
    additional_data: {
      postal_zone_id_from: '113', postal_zone_name_from: 'Italia', zip_code_id_from: 'zc-42122',
      postal_zone_id_to: '113', postal_zone_name_to: 'Italia', zip_code_id_to: 'zc-00144', selectedWarehouseId: 'w1',
    },
  });
  // The warehouse id is never sent as an address field.
  expect(payload.from).not.toHaveProperty('id');
  // Unresolved side: only zip_code, no state, no ids (pre-fix payload for that side).
  const partial = buildPacklinkDraftPayload(warehouse, built.input, { from: null, to: null });
  expect(partial.to).not.toHaveProperty('state');
  expect(partial.additional_data).toEqual({ selectedWarehouseId: 'w1' });
});

test('adapter: locations are read before the single POST; a lookup outage still creates the draft with zip_code', async () => {
  const http = mock();
  const db = fakeDb(baseOrder({ shipping_creation_status: 'pending' }));
  await createShipmentDraftForOrder(db.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps());
  expect(db.order().shipping_creation_status).toBe('draft_created');
  const lookups = http.calls.filter(call => call.url.includes('/locations/'));
  expect(lookups.map(call => call.method)).toEqual(['GET', 'GET', 'GET']);
  expect(lookups.some(call => call.url.endsWith('/locations/postalcodes/IT/42121'))).toBe(true);
  expect(lookups.some(call => call.url.includes('platform_country=IT') && call.url.includes('language=it_IT'))).toBe(true);
  const postIndex = http.calls.findIndex(call => call.method === 'POST');
  expect(http.calls.slice(postIndex + 1).some(call => call.url.includes('/locations/'))).toBe(false);
  expect(http.posts()).toHaveLength(1);
  expect(http.posts()[0]!.body).toMatchObject({
    to: { zip_code: '42121', city: 'Reggio Emilia', state: 'Italia' },
    additional_data: { zip_code_id_to: 'zc-42121', postal_zone_id_to: '113', zip_code_id_from: 'zc-42122', selectedWarehouseId: 'w1' },
  });
  http.restore();

  const down = mock(undefined, 'down');
  const db2 = fakeDb(baseOrder({ shipping_creation_status: 'pending' }));
  await createShipmentDraftForOrder(db2.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps());
  expect(db2.order().shipping_creation_status).toBe('draft_created');
  expect(down.posts()).toHaveLength(1);
  const body = down.posts()[0]!.body!;
  expect(body.to).toMatchObject({ zip_code: '42121', city: 'Reggio Emilia', country: 'IT' });
  expect(body.to).not.toHaveProperty('state');
  expect(body.additional_data).toEqual({ selectedWarehouseId: 'w1' });
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

// ─── Draft deleted in Packlink PRO → release and recreate ────────────────────
const DRAFTED = baseOrder({
  shipping_creation_status: 'draft_created', shipping_creation_attempts: 1, shipping_tracking_mode: 'managed',
  shipping_provider_key: 'packlink', shipping_provider_reference: 'IT2026PRO0006698079', shipping_normalized_status: 'pending',
  shipping_provider_created_at: '2026-10-09T09:00:00Z',
});
const resolving = (outcome: 'missing' | 'exists' | 'cancelled' | 'down') => (key: string | null | undefined) =>
  key === 'packlink' ? { ...packlinkAdapter, async resolveShipment(_context: unknown, reference: string) {
    if (outcome === 'missing') throw new ShippingProviderError('shipment_not_found');
    if (outcome === 'down') throw new ShippingProviderError('shipping_provider_unavailable');
    return { provider: 'packlink', providerReference: reference, carrier: null, trackingCode: null, trackingUrl: null, estimatedDeliveryAt: null,
      providerStatus: outcome === 'cancelled' ? 'CANCELLED' : 'AWAITING_COMPLETION', normalizedStatus: outcome === 'cancelled' ? 'cancelled' : 'pending', events: [] };
  } } as ShippingProviderAdapter : null;

test('release: a draft deleted in Packlink (404) is detached, then a corrected draft is created', async () => {
  const db = fakeDb(DRAFTED);
  expect(await releaseDeletedShipmentDraft(db.service, 'tenant-a', ORDER_ID, deps(undefined, resolving('missing')))).toEqual({ outcome: 'released' });
  expect(db.order()).toMatchObject({
    shipping_provider_reference: null, shipping_provider_key: null, shipping_tracking_mode: null,
    shipping_creation_status: null, shipping_normalized_status: null, status: 'preparing',
  });
  const http = mock();
  expect((await createShipmentDraftForOrder(db.service, 'tenant-a', ORDER_ID, { mode: 'manual' }, deps())).outcome).toBe('created');
  expect(http.posts()).toHaveLength(1);
  // A shipment cancelled at the provider is releasable too.
  expect(await releaseDeletedShipmentDraft(fakeDb(DRAFTED).service, 'tenant-a', ORDER_ID, deps(undefined, resolving('cancelled'))))
    .toEqual({ outcome: 'released' });
});

test('release: never while the draft still exists, the provider is unreachable, the parcel moves or for another tenant', async () => {
  const db = fakeDb(DRAFTED);
  expect(await releaseDeletedShipmentDraft(db.service, 'tenant-a', ORDER_ID, deps(undefined, resolving('exists')))).toEqual({ outcome: 'still_exists' });
  await expect(releaseDeletedShipmentDraft(db.service, 'tenant-a', ORDER_ID, deps(undefined, resolving('down')))).rejects.toThrow('shipping_provider_unavailable');
  expect(db.order().shipping_provider_reference).toBe('IT2026PRO0006698079');
  const moving = fakeDb({ ...DRAFTED, shipping_normalized_status: 'in_transit' });
  expect(await releaseDeletedShipmentDraft(moving.service, 'tenant-a', ORDER_ID, deps(undefined, resolving('missing'))))
    .toEqual({ outcome: 'skipped', reason: 'in_transit' });
  // A reference attached by hand (not created by Lepefy) is not touched by this action.
  const attached = fakeDb({ ...DRAFTED, shipping_creation_status: null });
  expect(await releaseDeletedShipmentDraft(attached.service, 'tenant-a', ORDER_ID, deps(undefined, resolving('missing'))))
    .toEqual({ outcome: 'skipped', reason: 'no_draft' });
  expect(await releaseDeletedShipmentDraft(db.service, 'tenant-b', ORDER_ID, deps(undefined, resolving('missing'))))
    .toEqual({ outcome: 'skipped', reason: 'order_inactive' });
  expect(db.updates).toHaveLength(0);
  expect(permissionForAdminApi(`/api/admin/orders/${ORDER_ID}/shipment/release`, 'POST')).toBe('orders.manage');
});

test('regression: an unpurchased draft (shipment 200, /track 404) still exists — sync works and release is refused', async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/track')) return new Response('{"messages":[{"message":"Not found"}]}', { status: 404 });
    if (/\/shipments\/IT2026PRO0006698079$/.test(url)) return new Response(JSON.stringify({ reference: 'IT2026PRO0006698079', state: 'AWAITING_COMPLETION' }), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  try {
    const snapshot = await packlinkAdapter.resolveShipment({ tenantId: 'tenant-a', tenant: { packlink_api_key: 'k' } }, 'IT2026PRO0006698079');
    expect(snapshot).toMatchObject({ providerStatus: 'AWAITING_COMPLETION', normalizedStatus: 'pending', events: [] });
    const db = fakeDb(DRAFTED);
    expect(await releaseDeletedShipmentDraft(db.service, 'tenant-a', ORDER_ID, deps())).toEqual({ outcome: 'still_exists' });
    expect(db.order().shipping_provider_reference).toBe('IT2026PRO0006698079');
    // A shipment that really is gone (404 on the shipment itself) is still reported as not found.
    await expect(packlinkAdapter.resolveShipment({ tenantId: 'tenant-a', tenant: { packlink_api_key: 'k' } }, 'IT2026PRO0000000404'))
      .rejects.toThrow('shipment_not_found');
  } finally { globalThis.fetch = original; }
});
