import { test, expect } from '@playwright/test';
import type { Tenant } from '@lepefy/types';
import {
  DEFAULT_ORDER_DOCUMENT_FORMAT, MAX_BULK_ORDER_DOCUMENTS, ORDER_DOCUMENT_FORMATS, isOrderDocumentFormat, resolveRequestedFormat,
} from '../../src/lib/orders/documents/formats';
import {
  ORDER_DOCUMENTS_DEFAULTS, orderDocumentsPatchSchema, readOrderDocumentSettings, resolveOrderDocumentSettings,
} from '../../src/lib/orders/documents/settings';
import { escapeHtml, orderShortRef, readableBrandColor, safeImageUrl } from '../../src/lib/orders/documents/documentHtml';
import {
  buildPackingSlipViewModel, buildPickingListViewModel, firstName,
  type DocumentItemRow, type DocumentOrderRow, type DocumentTenant,
} from '../../src/lib/orders/documents/viewModels';
import { pickingListHtml } from '../../src/lib/orders/documents/pickingListHtml';
import { packingSlipHtml } from '../../src/lib/orders/documents/packingSlipHtml';
import {
  orderDocumentFilename, parseOrderIdList, renderOrderDocuments, OrderDocumentError,
} from '../../src/lib/orders/documents/renderOrderDocuments';
import { gotenbergOptionFields } from '../../src/lib/labels/gotenberg';
import { suggestCartons, type CartonProfile } from '../../src/lib/shipping/cartonSuggestion';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { fakeDb } from './helpers/fakeSupabase';

const ORDER_A = '163835b8-1111-4222-8333-444455556666';
const ORDER_B = 'cc4314fe-9a1b-4c2e-8d77-1f0e5b3a9c21';
const ORDER_OTHER_TENANT = 'aaaaaaaa-1111-4222-8333-444455556666';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function order(id: string, overrides: Partial<DocumentOrderRow> = {}): DocumentOrderRow & { tenant_id: string; email: string; notes: string } {
  return {
    id, tenant_id: TENANT_A, created_at: '2026-10-05T07:14:00Z', status: 'preparing', fulfillment_type: 'delivery',
    full_name: 'Awa Diallo', email: 'awa.d@example.fr', notes: 'Téléphone: 0612345678',
    shipping_address: { full_name: 'Awa Diallo', line1: '12 rue Oberkampf', postal_code: '75011', city: 'Paris', country: 'FR' },
    shipping_details: { totalWeightG: 7400 }, shipping_cost: 9.9, total: 64.4,
    ...overrides,
  };
}

function item(orderId: string, name: string, overrides: Partial<DocumentItemRow> = {}): DocumentItemRow & { tenant_id: string } {
  return {
    order_id: orderId, tenant_id: TENANT_A, product_id: `p-${name}`, name, name_alt: null, price: 5, quantity: 2, subtotal: 10,
    storage_type: 'dry', warehouse_location: null, ...overrides,
  };
}

const ITEMS: DocumentItemRow[] = [
  item(ORDER_A, 'Kaolin 500 g', { quantity: 1, subtotal: 4.5, price: 4.5 }),
  item(ORDER_A, 'Mitoumba', { quantity: 7, warehouse_location: 'B-04', price: 3, subtotal: 21 }),
  item(ORDER_A, 'Bobolo sous vide', { storage_type: 'fresh', warehouse_location: 'FRIGO-1', price: 9, subtotal: 18 }),
];

const PROFILES: CartonProfile[] = [
  { id: 'S', name: 'Carton S', box_length_cm: 35, box_width_cm: 25, box_height_cm: 22, active: true, position: 1, suggest_min_weight_g: 0, suggest_max_weight_g: 5000 },
  { id: 'M', name: 'Standard', box_length_cm: 40, box_width_cm: 30, box_height_cm: 30, active: true, position: 2, suggest_min_weight_g: 5000, suggest_max_weight_g: 15000 },
];

const DOC_TENANT: DocumentTenant = {
  name: 'Boutique Test', logo_url: 'https://cdn.example.com/logo.png', primary_color: '#0b3d91', currency: 'EUR',
  storefront_url: 'https://shop.example.com', whatsapp_number: '+33 6 12 34 56 78', legal_email: 'contact@example.com',
  android_package_name: null, android_public: false,
};

// ─── Formats ────────────────────────────────────────────────────────────────

test('formats: A5 is the platform default, A4 is available, unknown values are rejected', () => {
  expect(DEFAULT_ORDER_DOCUMENT_FORMAT).toBe('a5');
  expect(ORDER_DOCUMENT_FORMATS.a5).toMatchObject({ widthMm: 148, heightMm: 210, cssPageSize: 'A5 portrait', recommended: true });
  expect(ORDER_DOCUMENT_FORMATS.a4).toMatchObject({ widthMm: 210, heightMm: 297, cssPageSize: 'A4 portrait', recommended: false });
  expect(resolveRequestedFormat(null, 'a5')).toBe('a5');
  expect(resolveRequestedFormat('', 'a4')).toBe('a4');
  expect(resolveRequestedFormat('A4', 'a5')).toBe('a4');
  expect(resolveRequestedFormat('letter', 'a5')).toBeNull();
  expect(isOrderDocumentFormat('thermal_80')).toBe(false);
});

// ─── Settings ───────────────────────────────────────────────────────────────

test('settings: missing row → safe defaults (A5, slip enabled, prices hidden); invalid row never shows prices', () => {
  expect(resolveOrderDocumentSettings(null).config).toEqual(ORDER_DOCUMENTS_DEFAULTS);
  expect(ORDER_DOCUMENTS_DEFAULTS).toMatchObject({ picking_list_format: 'a5', packing_slip_enabled: true, packing_slip_format: 'a5', packing_slip_show_prices: false, packing_slip_show_qr: true, packing_slip_show_delivery_address: false });
  const invalid = resolveOrderDocumentSettings({ enabled: true, config: { packing_slip_show_prices: true, picking_list_format: 'letter' } });
  expect(invalid.status).toBe('invalid');
  expect(invalid.config.packing_slip_show_prices).toBe(false);
  const unknownKey = resolveOrderDocumentSettings({ enabled: true, config: { packing_slip_show_prices: true, evil: 1 } });
  expect(unknownKey.config.packing_slip_show_prices).toBe(false);
});

test('settings: tenant A = A5, tenant B = A4, no cross-tenant contamination; fallback when migration is absent', async () => {
  const db = fakeDb({
    platform_features: [{ key: 'order_documents' }],
    tenant_feature_settings: [
      { tenant_id: TENANT_B, feature_key: 'order_documents', enabled: true, config: { version: 1, picking_list_format: 'a4', packing_slip_format: 'a4' } },
    ],
  });
  const a = await readOrderDocumentSettings(db as never, TENANT_A);
  const b = await readOrderDocumentSettings(db as never, TENANT_B);
  expect(a.config.picking_list_format).toBe('a5');
  expect(b.config.picking_list_format).toBe('a4');
  expect(b.config.packing_slip_format).toBe('a4');
  const noMigration = await readOrderDocumentSettings(fakeDb({ platform_features: [] }) as never, TENANT_A);
  expect(noMigration).toMatchObject({ available: false, config: ORDER_DOCUMENTS_DEFAULTS });
});

test('settings PATCH schema: partial updates accepted, unknown fields and bad formats rejected', () => {
  expect(orderDocumentsPatchSchema.safeParse({ config: { picking_list_format: 'a4' } }).success).toBe(true);
  expect(orderDocumentsPatchSchema.safeParse({ config: { picking_list_format: 'letter' } }).success).toBe(false);
  expect(orderDocumentsPatchSchema.safeParse({ config: { show_secret: true } }).success).toBe(false);
  expect(orderDocumentsPatchSchema.safeParse({ config: { version: 2 } }).success).toBe(false);
});

// ─── View models ────────────────────────────────────────────────────────────

test('picking view-model keeps operational data: locations sorted, cold chain, cartons for delivery only', () => {
  const suggestion = suggestCartons(7400, PROFILES, 15000);
  const vm = buildPickingListViewModel({ order: order(ORDER_A), items: ITEMS, tenant: { name: 'Boutique Test' }, carton: { suggestion, missingWeightLines: 0, maxParcelG: 15000 } });
  expect(vm.ref).toBe('163835B8');
  expect(vm.items.map((i) => i.location)).toEqual(['B-04', 'FRIGO-1', null]);
  expect(vm.items.find((i) => i.name === 'Bobolo sous vide')?.storage).toBe('fresh');
  expect(vm.totalUnits).toBe(10);
  expect(vm.cartons?.lines[0]).toMatchObject({ count: 1, name: 'Standard' });
  expect(vm.destination).toBe('75011 Paris, FR');
  const pickup = buildPickingListViewModel({ order: order(ORDER_A, { fulfillment_type: 'pickup' }), items: ITEMS, tenant: { name: 'T' }, carton: { suggestion, missingWeightLines: 0 } });
  expect(pickup.cartons).toBeNull();
  expect(pickup.fulfillmentLabel).toBe('RETRAIT');
});

test('packing slip view-model is customer-safe by construction and hides prices by default', () => {
  const raw = order(ORDER_A);
  const vm = buildPackingSlipViewModel({ order: raw, items: ITEMS, tenant: DOC_TENANT, settings: ORDER_DOCUMENTS_DEFAULTS, qr: null });
  const serialized = JSON.stringify(vm);
  for (const forbidden of ['B-04', 'FRIGO-1', 'warehouse', 'awa.d@example.fr', '0612345678', ORDER_A, 'Oberkampf', 'carton', 'storage']) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(vm.prices).toBeNull();
  expect(vm.items.every((i) => i.unitPrice === null && i.lineTotal === null)).toBe(true);
  expect(vm.deliveryAddress).toBeNull();
  expect(vm.greeting).toBe('Merci Awa !');
});

test('packing slip shows historical order prices only when enabled', () => {
  const vm = buildPackingSlipViewModel({ order: order(ORDER_A), items: ITEMS, tenant: DOC_TENANT, settings: { ...ORDER_DOCUMENTS_DEFAULTS, packing_slip_show_prices: true }, qr: null });
  expect(vm.items.find((i) => i.name === 'Mitoumba')?.lineTotal).toContain('21,00');
  expect(vm.prices?.lines.map((l) => l.label)).toEqual(['Articles', 'Livraison']);
  expect(vm.prices?.total).toContain('64,40');
});

test('helpers: short ref, first name, brand colour contrast fallback, https-only images', () => {
  expect(orderShortRef(ORDER_B)).toBe('CC4314FE');
  expect(firstName('  Awa  Diallo ')).toBe('Awa');
  expect(firstName(null)).toBeNull();
  expect(readableBrandColor('#0b3d91')).toBe('#0b3d91');
  expect(readableBrandColor('#f5c518')).toBe('#111111');
  expect(readableBrandColor('javascript:alert(1)')).toBe('#111111');
  expect(safeImageUrl('http://insecure.example/logo.png')).toBeNull();
  expect(safeImageUrl('javascript:alert(1)')).toBeNull();
});

// ─── HTML ───────────────────────────────────────────────────────────────────

test('picking HTML: @page per format, one section per order (page breaks), escaped content', () => {
  const evil = [item(ORDER_A, '<script>alert(1)</script>', { warehouse_location: '"><img src=x>' })];
  const vmA = buildPickingListViewModel({ order: order(ORDER_A), items: evil, tenant: { name: 'T & Co' }, carton: null });
  const vmB = buildPickingListViewModel({ order: order(ORDER_B), items: ITEMS, tenant: { name: 'T & Co' }, carton: null });
  const a5 = pickingListHtml([vmA, vmB], 'a5');
  expect(a5).toContain('@page { size: A5 portrait; }');
  expect(a5.match(/<section class="doc">/g)?.length).toBe(2);
  expect(a5).toContain('break-after: page');
  expect(a5).not.toContain('<script>alert(1)</script>');
  expect(a5).toContain('&lt;script&gt;');
  expect(a5).not.toContain('"><img src=x>');
  expect(a5).toContain('T &amp; Co');
  expect(a5).toContain('LISTE DE PRÉPARATION');
  expect(a5).not.toMatch(/PICKING LIST|QTÀ|FRESCO/);
  const a4 = pickingListHtml([vmB], 'a4');
  expect(a4).toContain('@page { size: A4 portrait; }');
  expect(a4).toContain('NOTES DE PRÉPARATION');
  expect(a4).toContain('CONSERV.');
});

test('packing slip HTML: QR block with readable URL; never internal data', () => {
  const vm = buildPackingSlipViewModel({
    order: order(ORDER_A), items: ITEMS, tenant: DOC_TENANT, settings: ORDER_DOCUMENTS_DEFAULTS,
    qr: { url: 'https://shop.example.com/o/AbCdEfGhIjKlMnOpQrStUv', displayUrl: 'shop.example.com/o/AbCdEfGhIjKlMnOpQrStUv', svg: '<svg viewBox="0 0 10 10"></svg>' },
  });
  const html = packingSlipHtml([vm], 'a5');
  expect(html).toContain('@page { size: A5 portrait; }');
  expect(html).toContain('RÉCAPITULATIF DE COMMANDE');
  expect(html).toContain('Scannez pour suivre votre commande');
  expect(html).toContain('shop.example.com/o/AbCdEfGhIjKlMnOpQrStUv');
  for (const forbidden of ['B-04', 'FRIGO-1', 'awa.d@example.fr', 'EMBALLAGE', 'pl-box', ORDER_A]) expect(html).not.toContain(forbidden);
  expect(escapeHtml(`<a href="x">'`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;');
});

// ─── Bulk helpers ───────────────────────────────────────────────────────────

test('bulk: id list keeps selection order, drops duplicates and non-UUIDs; readable filenames', () => {
  expect(parseOrderIdList(`${ORDER_B},${ORDER_A},${ORDER_B},drop table,`)).toEqual([ORDER_B, ORDER_A]);
  expect(orderDocumentFilename('picking_list', 'a5', { orderId: ORDER_B })).toBe('commande-CC4314FE-preparation-a5.pdf');
  expect(orderDocumentFilename('packing_slip', 'a4', { orderId: ORDER_B })).toBe('commande-CC4314FE-bon-de-colis-a4.pdf');
  expect(orderDocumentFilename('picking_list', 'a5', { date: new Date('2026-10-05T10:00:00Z') })).toBe('preparation-2026-10-05-a5.pdf');
  expect(MAX_BULK_ORDER_DOCUMENTS).toBe(50);
});

test('gotenberg options: paper size and margins in inches, footer optional', () => {
  const fields = Object.fromEntries(gotenbergOptionFields({ paperWidthMm: 148, paperHeightMm: 210, marginsMm: { top: 9, right: 9, bottom: 13, left: 9 }, printBackground: true }));
  expect(fields).toMatchObject({ paperWidth: '5.827', paperHeight: '8.268', marginTop: '0.354', marginBottom: '0.512', printBackground: 'true' });
  expect(gotenbergOptionFields({})).toEqual([]);
});

// ─── Service with mocked Gotenberg ──────────────────────────────────────────

function documentsDb() {
  return fakeDb({
    platform_features: [{ key: 'order_documents' }],
    orders: [order(ORDER_A), order(ORDER_B, { status: 'new' }), { ...order(ORDER_OTHER_TENANT), tenant_id: TENANT_B }, order('dddddddd-1111-4222-8333-444455556666', { status: 'cancelled' })],
    order_items: [...ITEMS.map((i) => ({ ...i, tenant_id: TENANT_A })), { ...item(ORDER_B, 'Huile de palme 1 L'), tenant_id: TENANT_A }, { ...item(ORDER_OTHER_TENANT, 'Secret'), tenant_id: TENANT_B }],
    shipping_packaging_profiles: PROFILES.map((p) => ({ ...p, tenant_id: TENANT_A })),
    packaging_surcharges: [],
    products: [],
    order_public_access_tokens: [],
  });
}

const TENANT = { id: TENANT_A, name: 'Boutique Test', logo_url: null, primary_color: '#0b3d91', currency: 'EUR', storefront_url: 'https://shop.example.com', whatsapp_number: null, legal_email: null, android_package_name: null, android_public: false } as unknown as Tenant;

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function withGotenberg<T>(fn: (calls: FormData[]) => Promise<T>, response: () => Response = () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 })): Promise<T> {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.GOTENBERG_URL;
  const previousSecret = process.env.TRACKING_SECRET;
  const calls: FormData[] = [];
  process.env.GOTENBERG_URL = 'http://gotenberg.test';
  process.env.TRACKING_SECRET = 'test-secret';
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => { calls.push(init?.body as FormData); return response(); }) as typeof fetch;
  try { return await fn(calls); } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('GOTENBERG_URL', previousUrl);
    restoreEnv('TRACKING_SECRET', previousSecret);
  }
}

async function htmlOf(form: FormData): Promise<string> {
  return (form.get('files') as Blob).text();
}

test('render: bulk keeps selection order, one document per order, other-tenant and cancelled orders excluded', async () => {
  await withGotenberg(async (calls) => {
    const result = await renderOrderDocuments({
      db: documentsDb() as never, tenant: TENANT, kind: 'picking_list', format: 'a5', settings: ORDER_DOCUMENTS_DEFAULTS, bulk: true,
      orderIds: [ORDER_B, ORDER_OTHER_TENANT, 'dddddddd-1111-4222-8333-444455556666', ORDER_A],
    });
    expect(result.documentCount).toBe(2);
    expect(result.skipped).toBe(2);
    const html = await htmlOf(calls[0]!);
    expect(html.indexOf('#CC4314FE')).toBeLessThan(html.indexOf('#163835B8'));
    expect(html).not.toContain('Secret');
    expect(calls[0]!.get('paperWidth')).toBe('5.827');
    expect(calls[0]!.getAll('files')).toHaveLength(2); // index.html + footer.html
  });
});

test('render: single order errors — not found / other tenant 404, cancelled 409, slip disabled 409, batch > 50 → 413', async () => {
  await withGotenberg(async () => {
    const base = { db: documentsDb() as never, tenant: TENANT, format: 'a5' as const, settings: ORDER_DOCUMENTS_DEFAULTS, bulk: false };
    await expect(renderOrderDocuments({ ...base, kind: 'picking_list', orderIds: [ORDER_OTHER_TENANT] })).rejects.toMatchObject({ status: 404 });
    await expect(renderOrderDocuments({ ...base, kind: 'picking_list', orderIds: ['dddddddd-1111-4222-8333-444455556666'] })).rejects.toMatchObject({ status: 409 });
    await expect(renderOrderDocuments({ ...base, kind: 'packing_slip', settings: { ...ORDER_DOCUMENTS_DEFAULTS, packing_slip_enabled: false }, orderIds: [ORDER_A] })).rejects.toMatchObject({ status: 409 });
    const many = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    await expect(renderOrderDocuments({ ...base, bulk: true, kind: 'picking_list', orderIds: many })).rejects.toBeInstanceOf(OrderDocumentError);
    await expect(renderOrderDocuments({ ...base, bulk: true, kind: 'picking_list', orderIds: many })).rejects.toMatchObject({ status: 413 });
  });
});

test('render: Gotenberg unavailable → 503, conversion error → 502', async () => {
  const base = { db: documentsDb() as never, tenant: TENANT, kind: 'picking_list' as const, format: 'a4' as const, settings: ORDER_DOCUMENTS_DEFAULTS, bulk: false, orderIds: [ORDER_A] };
  await withGotenberg(async () => {
    await expect(renderOrderDocuments(base)).rejects.toMatchObject({ status: 503 });
  }, () => new Response('down', { status: 503 }));
  await withGotenberg(async () => {
    await expect(renderOrderDocuments(base)).rejects.toMatchObject({ status: 502 });
  }, () => new Response('bad html', { status: 400 }));
  const previous = process.env.GOTENBERG_URL;
  delete process.env.GOTENBERG_URL;
  try { await expect(renderOrderDocuments(base)).rejects.toMatchObject({ status: 503 }); } finally { restoreEnv('GOTENBERG_URL', previous); }
});

test('render: packing slip reuses the same QR token across reprints, QR points to the tenant storefront', async () => {
  const db = documentsDb();
  await withGotenberg(async (calls) => {
    const base = { db: db as never, tenant: TENANT, kind: 'packing_slip' as const, format: 'a5' as const, settings: ORDER_DOCUMENTS_DEFAULTS, bulk: false, orderIds: [ORDER_A] };
    await renderOrderDocuments(base);
    await renderOrderDocuments(base);
    const first = await htmlOf(calls[0]!);
    const second = await htmlOf(calls[1]!);
    const url = first.match(/shop\.example\.com\/o\/([A-Za-z0-9_-]{22})/)?.[1];
    expect(url).toBeTruthy();
    expect(second).toContain(`shop.example.com/o/${url}`);
    expect(first).not.toContain(ORDER_A);
    expect(db.tables.order_public_access_tokens).toHaveLength(1);
    expect(JSON.stringify(db.tables.order_public_access_tokens)).not.toContain(url!);
  });
});

test('render: packing slip without migration 145 is generated without QR instead of failing', async () => {
  const db = documentsDb();
  db.failures.order_public_access_tokens = { code: '42P01', message: 'relation "order_public_access_tokens" does not exist' };
  await withGotenberg(async (calls) => {
    await renderOrderDocuments({ db: db as never, tenant: TENANT, kind: 'packing_slip', format: 'a5', settings: ORDER_DOCUMENTS_DEFAULTS, bulk: false, orderIds: [ORDER_A] });
    const html = await htmlOf(calls[0]!);
    expect(html).toContain('RÉCAPITULATIF DE COMMANDE');
    expect(html).not.toContain('Scannez pour suivre');
  });
});

// ─── Security: admin API map ────────────────────────────────────────────────

test('security: document routes need orders.view, settings need tenant_settings.view/manage', () => {
  expect(permissionForAdminApi(`/api/admin/orders/${ORDER_A}/documents/picking-list`, 'GET')).toBe('orders.view');
  expect(permissionForAdminApi('/api/admin/orders/documents/packing-slip', 'GET')).toBe('orders.view');
  expect(permissionForAdminApi('/api/admin/order-documents/settings', 'GET')).toBe('tenant_settings.view');
  expect(permissionForAdminApi('/api/admin/order-documents/settings', 'PATCH')).toBe('tenant_settings.manage');
});
