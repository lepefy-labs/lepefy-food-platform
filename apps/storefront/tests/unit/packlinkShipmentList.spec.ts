import { expect, test } from '@playwright/test';
import {
  PACKLINK_LIST_MAX_BYTES,
  PACKLINK_LIST_MAX_PAGE,
  PACKLINK_LIST_ROW_LIMIT,
  PACKLINK_SHIPMENTS_URL,
  listPacklinkShipments,
  locateShipmentArray,
  parsePageParam,
  readPacklinkPagination,
  summarizePacklinkShipment,
  type LepefyOrderLink,
} from '../../src/lib/shipping/packlinkShipmentList';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

// Shape observed from the real GET /v1/shipments on 2026-09-28; values are fake.
const listRecord = (reference: string, status = 'DELIVERED') => ({
  status,
  delivery: { name: 'Mario', surname: 'Test', company: null, street1: 'Via Esempio 1', street2: null,
    zip_code: '20100', city: 'Milano', state: 'MI', country: 'IT', phone: '000', email: 'x@example.invalid',
    address_id: null, postalcode: '20100' },
  weight: '28.0',
  service: 'Standard Home2Home',
  collection: { name: 'Shop', surname: 'Sender', city: 'Roma', country: 'IT' },
  parcels: [
    { width: '30.0', height: '30.0', length: '40.0', weight: '16.0' },
    { width: '30.0', height: '30.0', length: '40.0', weight: '12.0' },
  ],
  content: 'Alimentari',
  carrier: 'brt',
  collectionDate: '2026/09/25',
  parcel_number: '2',
  shipment_custom_reference: null,
  orderDate: '2026/09/24',
  reference,
  has_customs: false,
  source: 'PRO',
  canceled: false,
  price: '0',
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call { url: string; init?: RequestInit }

function mockFetch(response: Response | (() => Promise<Response>)) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return typeof response === 'function' ? response() : response;
  }) as typeof fetch;
  return { impl, calls };
}

const noOrders = async () => new Map<string, LepefyOrderLink>();

function run(fetchImpl: typeof fetch, overrides: Partial<Parameters<typeof listPacklinkShipments>[0]> = {}) {
  let tick = 1_000;
  return listPacklinkShipments({
    shippingProvider: 'packlink',
    apiKey: 'tenant-key',
    fetchImpl,
    lookupOrders: noOrders,
    now: () => (tick += 50),
    ...overrides,
  });
}

test.describe('summarizePacklinkShipment', () => {
  test('maps the observed list record', () => {
    const summary = summarizePacklinkShipment(listRecord('IT2026PRO0000000001', 'IN_TRANSIT'));
    expect(summary).toMatchObject({
      reference: 'IT2026PRO0000000001',
      status: 'IN_TRANSIT',
      recipientName: 'Mario Test',
      recipientCompany: null,
      street: 'Via Esempio 1',
      postalCode: '20100',
      city: 'Milano',
      country: 'IT',
      carrier: 'brt',
      service: 'Standard Home2Home',
      trackingCodes: [],
      createdAt: '2026/09/24',
      collectionDate: '2026/09/25',
      canceled: false,
      source: 'PRO',
      price: 0,
      parcelCount: 2,
      totalWeightKg: 28,
    });
    expect(summary.packages[0]).toEqual({ weightKg: 16, widthCm: 30, heightCm: 30, lengthCm: 40 });
  });

  test('falls back to official DTO keys', () => {
    const summary = summarizePacklinkShipment({
      packlink_reference: 'ES00019388AB', state: 'DELIVERED', trackings: ['T1', 'T1', 'T2'],
      price: { base_price: 7.5 }, currency: 'EUR', order_date: '2026-09-01',
      to: { name: 'Ana', city: 'Madrid', zip_code: '28001', country: 'ES' },
      packages: [{ weight: 2, width: 10, height: 10, length: 10 }],
    });
    expect(summary).toMatchObject({ reference: 'ES00019388AB', status: 'DELIVERED', trackingCodes: ['T1', 'T2'],
      price: 7.5, createdAt: '2026-09-01', city: 'Madrid', parcelCount: 1 });
  });

  test('never throws on garbage and leaves fields null', () => {
    for (const value of [null, 42, 'x', [], { delivery: 'nope', parcels: 'nope' }]) {
      const summary = summarizePacklinkShipment(value);
      expect(summary.reference).toBeNull();
      expect(summary.packages).toEqual([]);
    }
  });
});

test.describe('locateShipmentArray', () => {
  test('recognises root arrays and known containers only', () => {
    expect(locateShipmentArray([1])?.container).toBe('root');
    expect(locateShipmentArray({ shipments: [], pagination: {} })?.container).toBe('shipments');
    expect(locateShipmentArray({ results: [] })?.container).toBe('results');
    expect(locateShipmentArray({ items: [] })).toBeNull();
    expect(locateShipmentArray('x')).toBeNull();
  });
});

test.describe('listPacklinkShipments', () => {
  test('lists shipments read-only with the tenant key and reports pagination hints', async () => {
    const { impl, calls } = mockFetch(jsonResponse({
      shipments: [listRecord('IT2026PRO0000000001'), listRecord('IT2026PRO0000000002', 'IN_TRANSIT')],
      pagination: { page: 1, total: 57 },
    }));
    const result = await run(impl);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(PACKLINK_SHIPMENTS_URL);
    expect(calls[0]?.init?.method).toBe('GET');
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('tenant-key');
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.completeness).toBe('unverified');
    expect(result.shipments.map(s => s.summary.status)).toEqual(['DELIVERED', 'IN_TRANSIT']);
    expect(result.diagnostics).toMatchObject({
      upstreamStatus: 200, container: 'shipments', receivedCount: 2, returnedCount: 2, truncated: false,
      responseKeys: ['shipments', 'pagination'],
      pagination: { verified: false, hints: { pagination: { page: 1, total: 57 } } },
    });
    expect(result.diagnostics.durationMs).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('tenant-key');
  });

  test('links only orders returned by the tenant lookup, case-insensitively', async () => {
    const { impl } = mockFetch(jsonResponse({ shipments: [listRecord('it2026pro0000000001'), listRecord('IT2026PRO0000000002')] }));
    let asked: string[] = [];
    const result = await run(impl, {
      lookupOrders: async (references) => {
        asked = references;
        return new Map([['IT2026PRO0000000001', { id: 'order-1', label: '#ORDER-1', status: 'shipped', createdAt: null }]]);
      },
    });
    expect(asked).toEqual(['IT2026PRO0000000001', 'IT2026PRO0000000002']);
    if (!result.available) throw new Error('expected success');
    expect(result.shipments[0]?.lepefyOrder?.id).toBe('order-1');
    expect(result.shipments[1]?.lepefyOrder).toBeNull();
    expect(result.orderLookup).toBe('ok');
  });

  test('keeps the Packlink list when the order lookup fails', async () => {
    const { impl } = mockFetch(jsonResponse({ shipments: [listRecord('IT2026PRO0000000001')] }));
    const result = await run(impl, { lookupOrders: async () => { throw new Error('db down'); } });
    if (!result.available) throw new Error('expected success');
    expect(result.orderLookup).toBe('error');
    expect(result.shipments).toHaveLength(1);
  });

  test('empty list is a success with zero rows, not an error', async () => {
    const { impl } = mockFetch(jsonResponse({ shipments: [], pagination: {} }));
    let lookups = 0;
    const result = await run(impl, { lookupOrders: async () => { lookups += 1; return new Map(); } });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.shipments).toEqual([]);
    expect(result.diagnostics.receivedCount).toBe(0);
    expect(lookups).toBe(0);
  });

  test('caps rows and flags truncation', async () => {
    const many = Array.from({ length: PACKLINK_LIST_ROW_LIMIT + 5 }, (_, i) => listRecord(`IT2026PRO${String(i).padStart(10, '0')}`));
    const { impl } = mockFetch(jsonResponse({ shipments: many }));
    const result = await run(impl);
    if (!result.available) throw new Error('expected success');
    expect(result.shipments).toHaveLength(PACKLINK_LIST_ROW_LIMIT);
    expect(result.diagnostics).toMatchObject({ receivedCount: PACKLINK_LIST_ROW_LIMIT + 5, truncated: true });
  });

  test('redacts credentials nested in records', async () => {
    const { impl } = mockFetch(jsonResponse({ shipments: [{ ...listRecord('IT2026PRO0000000001'), api_key: 'leak', auth: { access_token: 'leak' } }] }));
    const result = await run(impl);
    expect(JSON.stringify(result)).not.toContain('leak');
  });

  test('refuses non-Packlink tenants and missing tenant keys without calling Packlink', async () => {
    const { impl, calls } = mockFetch(jsonResponse({}));
    expect(await run(impl, { shippingProvider: 'manual' })).toMatchObject({ available: false, reason: 'provider_not_packlink' });
    expect(await run(impl, { apiKey: '  ' })).toMatchObject({ available: false, reason: 'tenant_api_key_missing' });
    expect(await run(impl, { apiKey: null })).toMatchObject({ available: false, reason: 'tenant_api_key_missing' });
    expect(calls).toHaveLength(0);
  });

  test('maps upstream failures without leaking the body', async () => {
    const cases: Array<[number, string]> = [[404, 'list_endpoint_not_available'], [405, 'list_endpoint_not_available'],
      [401, 'packlink_unauthorized'], [403, 'packlink_unauthorized'], [500, 'packlink_error'], [429, 'packlink_error']];
    for (const [status, reason] of cases) {
      const { impl } = mockFetch(jsonResponse({ message: 'secret upstream detail' }, status));
      const result = await run(impl);
      expect(result).toMatchObject({ available: false, reason, diagnostics: { upstreamStatus: status } });
      expect(JSON.stringify(result)).not.toContain('secret upstream detail');
    }
  });

  test('network error and timeout become packlink_unavailable', async () => {
    const { impl } = mockFetch(() => Promise.reject(new DOMException('timeout', 'TimeoutError')));
    expect(await run(impl)).toMatchObject({ available: false, reason: 'packlink_unavailable', diagnostics: { upstreamStatus: null } });
  });

  test('invalid JSON, oversized body and unknown shapes are explicit failures', async () => {
    expect(await run(mockFetch(new Response('<html>', { status: 200 })).impl))
      .toMatchObject({ available: false, reason: 'invalid_packlink_response' });

    const huge = new Response('x'.repeat(PACKLINK_LIST_MAX_BYTES + 10), { status: 200 });
    expect(await run(mockFetch(huge).impl)).toMatchObject({ available: false, reason: 'response_too_large' });

    const unknown = await run(mockFetch(jsonResponse({ items: [], token: 'leak' })).impl);
    expect(unknown).toMatchObject({ available: false, reason: 'list_response_shape_unknown', diagnostics: { responseKeys: ['items', 'token'] } });
    expect(JSON.stringify(unknown)).not.toContain('leak');
  });
});

test.describe('pagination (observed shape: current_page, total_pages, total_registers, is_one_indexed)', () => {
  const page = (current: number, extra: Record<string, unknown> = {}) => jsonResponse({
    shipments: [listRecord(`IT2026PRO000000${String(current).padStart(4, '0')}`)],
    pagination: { current_page: current, total_pages: 245, total_registers: 2448, is_one_indexed: true, ...extra },
  });

  test('page 1 is requested without a query parameter and is verified', async () => {
    const { impl, calls } = mockFetch(page(1));
    const result = await run(impl);
    expect(calls[0]?.url).toBe(PACKLINK_SHIPMENTS_URL);
    if (!result.available) throw new Error('expected success');
    expect(result.completeness).toBe('paginated');
    expect(result.diagnostics.pagination).toMatchObject({
      requestedPage: 1, verified: true, currentPage: 1, totalPages: 245, totalRecords: 2448, oneIndexed: true,
    });
  });

  test('page N sends ?page=N and is accepted only when Packlink returns page N', async () => {
    const { impl, calls } = mockFetch(page(2));
    const result = await run(impl, { page: 2 });
    expect(calls[0]?.url).toBe(`${PACKLINK_SHIPMENTS_URL}?page=2`);
    expect(result).toMatchObject({ available: true, completeness: 'paginated', diagnostics: { endpoint: `GET ${PACKLINK_SHIPMENTS_URL}?page=2` } });
  });

  test('an ignored page parameter is rejected, never shown as the requested page', async () => {
    const result = await run(mockFetch(page(1)).impl, { page: 2 });
    expect(result).toMatchObject({
      available: false, reason: 'page_not_honored',
      diagnostics: { pagination: { requestedPage: 2, currentPage: 1, verified: false } },
    });
    expect(JSON.stringify(result)).not.toContain('IT2026PRO0000000001');
  });

  test('page > 1 without pagination metadata is rejected', async () => {
    const result = await run(mockFetch(jsonResponse({ shipments: [listRecord('IT2026PRO0000000001')] })).impl, { page: 3 });
    expect(result).toMatchObject({ available: false, reason: 'page_not_honored' });
  });

  test('zero-indexed metadata is normalized to 1-based pages', async () => {
    const result = await run(mockFetch(page(0, { is_one_indexed: false })).impl);
    if (!result.available) throw new Error('expected success');
    expect(result.diagnostics.pagination).toMatchObject({ currentPage: 1, verified: true, oneIndexed: false });
  });

  test('page 1 without pagination metadata stays unverified but visible', async () => {
    const result = await run(mockFetch(jsonResponse({ shipments: [listRecord('IT2026PRO0000000001')] })).impl);
    expect(result).toMatchObject({ available: true, completeness: 'unverified', diagnostics: { pagination: { verified: false, totalPages: null } } });
  });

  test('invalid pages never reach Packlink', async () => {
    const { impl, calls } = mockFetch(page(1));
    for (const bad of [0, -1, 1.5, PACKLINK_LIST_MAX_PAGE + 1]) {
      expect(await run(impl, { page: bad })).toMatchObject({ available: false, reason: 'invalid_page' });
    }
    expect(calls).toHaveLength(0);
  });

  test('parsePageParam accepts only bounded decimal integers', () => {
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam('')).toBe(1);
    expect(parsePageParam('2')).toBe(2);
    expect(parsePageParam('245')).toBe(245);
    for (const bad of ['0', '-1', '1.5', 'abc', '2&x=1', '1e3', '99999', ' 2']) {
      expect(parsePageParam(bad)).toBeNull();
    }
  });

  test('readPacklinkPagination ignores malformed metadata', () => {
    expect(readPacklinkPagination({ pagination: { current_page: 'x', total_pages: -3 } }, 1))
      .toMatchObject({ currentPage: null, totalPages: null, verified: false });
  });
});

test('packlink-shipments stays read-only under shipping.view', () => {
  expect(permissionForAdminApi('/api/admin/packlink-shipments', 'GET')).toBe('shipping.view');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    expect(permissionForAdminApi('/api/admin/packlink-shipments', method)).toBeNull();
  }
});
