import { test, expect } from '@playwright/test';
import {
  derivePortalToken, getOrCreateOrderPublicTokens, hashPortalToken, isWellFormedPortalToken, orderPortalDisplayUrl, orderPortalUrl,
  resolveOrderPublicToken, revokeOrderPublicTokens, PortalTokenUnavailableError,
} from '../../src/lib/orders/portal/orderPublicToken';
import { buildOrderPortalViewModel, type PortalOrderRow, type PortalTenant } from '../../src/lib/orders/portal/portalViewModel';
import { buildReorderProposal, type ReorderCatalogProduct } from '../../src/lib/orders/portal/reorderProposal';
import { buildSupportChannels } from '../../src/lib/orders/portal/supportChannels';
import { fakeDb } from './helpers/fakeSupabase';

const SECRET = 'unit-test-secret';
const ORDER = '163835b8-1111-4222-8333-444455556666';
const ORDER_2 = 'cc4314fe-9a1b-4c2e-8d77-1f0e5b3a9c21';

// ─── Token ──────────────────────────────────────────────────────────────────

test('token: 128-bit opaque, URL-safe, no order UUID or PII, depends on secret and nonce', () => {
  const token = derivePortalToken('row-1', 'nonce-aaaaaaaaaaaaaaaa', SECRET)!;
  expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(Buffer.from(token, 'base64url')).toHaveLength(16);
  expect(token).not.toContain(ORDER.slice(0, 8));
  expect(derivePortalToken('row-1', 'nonce-bbbbbbbbbbbbbbbb', SECRET)).not.toBe(token);
  expect(derivePortalToken('row-1', 'nonce-aaaaaaaaaaaaaaaa', 'other-secret')).not.toBe(token);
  expect(derivePortalToken('row-1', 'nonce', '')).toBeNull();
  expect(hashPortalToken(token)).toMatch(/^[0-9a-f]{64}$/);
  expect(isWellFormedPortalToken(token)).toBe(true);
  for (const bad of ['', 'short', `${token}x`, `${token.slice(0, 21)}/`, ORDER, null, 42]) expect(isWellFormedPortalToken(bad)).toBe(false);
  expect(orderPortalUrl('https://shop.example.com/', token)).toBe(`https://shop.example.com/o/${token}`);
  expect(orderPortalDisplayUrl(`https://www.shop.example.com/o/${token}`)).toBe(`shop.example.com/o/${token}`);
});

test('token: lazy creation stores only nonce + hash, reprint returns the same token, batch without N+1', async () => {
  const db = fakeDb({ order_public_access_tokens: [] });
  const first = await getOrCreateOrderPublicTokens(db as never, 'tenant-a', [ORDER, ORDER_2], SECRET);
  expect(first.size).toBe(2);
  const rows = db.tables.order_public_access_tokens!;
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(Object.keys(row).sort()).toEqual(['id', 'order_id', 'purpose', 'revoked_at', 'tenant_id', 'token_hash', 'token_nonce']);
    expect(JSON.stringify(row)).not.toContain(first.get(row.order_id as string)!);
    expect(row.token_hash).toBe(hashPortalToken(first.get(row.order_id as string)!));
  }
  const again = await getOrCreateOrderPublicTokens(db as never, 'tenant-a', [ORDER], SECRET);
  expect(again.get(ORDER)).toBe(first.get(ORDER));
  expect(rows).toHaveLength(2);
});

test('token: resolution — valid ok; wrong tenant, revoked, unknown, malformed → null', async () => {
  const db = fakeDb({ order_public_access_tokens: [] });
  const token = (await getOrCreateOrderPublicTokens(db as never, 'tenant-a', [ORDER], SECRET)).get(ORDER)!;
  expect(await resolveOrderPublicToken(db as never, 'tenant-a', token, SECRET)).toMatchObject({ orderId: ORDER });
  expect(await resolveOrderPublicToken(db as never, 'tenant-b', token, SECRET)).toBeNull();
  expect(await resolveOrderPublicToken(db as never, 'tenant-a', 'A'.repeat(22), SECRET)).toBeNull();
  expect(await resolveOrderPublicToken(db as never, 'tenant-a', ORDER, SECRET)).toBeNull();
  expect(await resolveOrderPublicToken(db as never, 'tenant-a', token, 'rotated-secret')).toBeNull();
  await revokeOrderPublicTokens(db as never, 'tenant-a', ORDER);
  expect(await resolveOrderPublicToken(db as never, 'tenant-a', token, SECRET)).toBeNull();
  const next = (await getOrCreateOrderPublicTokens(db as never, 'tenant-a', [ORDER], SECRET)).get(ORDER)!;
  expect(next).not.toBe(token);
  expect(await resolveOrderPublicToken(db as never, 'tenant-a', next, SECRET)).toMatchObject({ orderId: ORDER });
});

test('token: missing secret or table → PortalTokenUnavailableError (slip printed without QR)', async () => {
  await expect(getOrCreateOrderPublicTokens(fakeDb() as never, 'tenant-a', [ORDER], '')).rejects.toBeInstanceOf(PortalTokenUnavailableError);
  const db = fakeDb();
  db.failures.order_public_access_tokens = { code: 'PGRST205', message: 'Could not find the table' };
  await expect(getOrCreateOrderPublicTokens(db as never, 'tenant-a', [ORDER], SECRET)).rejects.toBeInstanceOf(PortalTokenUnavailableError);
});

// ─── Portal view-model ──────────────────────────────────────────────────────

const TENANT: PortalTenant = {
  name: 'Boutique Test', logo_url: null, whatsapp_number: '+33 6 12 34 56 78', legal_email: 'contact@example.com',
  click_collect_address: '14 rue de la Paix, Paris', click_collect_hours: 'Mar–Sam 10h–19h', google_maps_url: 'https://maps.google.com/?q=x',
  android_package_name: null, android_public: false,
};

function portalOrder(overrides: Partial<PortalOrderRow> = {}): PortalOrderRow {
  return {
    id: ORDER, created_at: '2026-10-05T07:00:00Z', status: 'preparing', fulfillment_type: 'delivery',
    tracking_code: null, tracking_carrier: null, shipping_details: null, ...overrides,
  };
}

function vm(order: PortalOrderRow, extra: { reviewAvailable?: boolean; reorderAvailable?: boolean } = {}) {
  return buildOrderPortalViewModel({
    order, items: [{ name: 'Mitoumba', quantity: 7 }], tenant: TENANT, shopBaseUrl: 'https://shop.example.com',
    reviewAvailable: extra.reviewAvailable ?? false, reorderAvailable: extra.reorderAvailable ?? true,
  });
}

test('portal: preparing → customer stage, support only, no tracking CTA', () => {
  const v = vm(portalOrder());
  expect(v.stageLabel).toBe('En préparation');
  expect(v.primary).toBeNull();
  expect(v.secondary.map((c) => c.kind)).toEqual(['support']);
  expect(v.ref).toBe('163835B8');
});

test('portal: shipped with safe tracking URL → track CTA + ETA; unsafe URL → no CTA', () => {
  const shipped = vm(portalOrder({ status: 'shipped', shipping_tracking_mode: 'managed', shipping_normalized_status: 'in_transit', shipping_tracking_url: 'https://tracking.example.com/abc', shipping_estimated_delivery_at: '2026-10-08T10:00:00Z' }));
  expect(shipped.headline).toBe('Votre livraison est en cours');
  expect(shipped.primary).toMatchObject({ kind: 'track', href: 'https://tracking.example.com/abc' });
  expect(shipped.shipment?.eta).toMatch(/8 oct/);
  const unsafe = vm(portalOrder({ status: 'shipped', shipping_tracking_url: 'javascript:alert(1)' }));
  expect(unsafe.primary).toBeNull();
  const noEta = vm(portalOrder({ status: 'shipped', shipping_tracking_url: 'https://t.example.com/x' }));
  expect(noEta.shipment?.eta ?? null).toBeNull();
});

test('portal: delivered → reorder first, review only when available, then support', () => {
  const withReview = vm(portalOrder({ status: 'delivered' }), { reviewAvailable: true });
  expect(withReview.primary?.kind).toBe('reorder');
  expect(withReview.secondary.map((c) => c.kind)).toEqual(['review', 'support']);
  const noReview = vm(portalOrder({ status: 'delivered' }));
  expect(noReview.secondary.map((c) => c.kind)).toEqual(['support']);
});

test('portal: pickup ready → maps CTA and public pickup address; cancelled → no pickup, support only', () => {
  const ready = vm(portalOrder({ status: 'ready_for_pickup', fulfillment_type: 'pickup' }));
  expect(ready.primary?.kind).toBe('maps');
  expect(ready.pickup?.address).toBe('14 rue de la Paix, Paris');
  expect(ready.shipment).toBeNull();
  const cancelled = vm(portalOrder({ status: 'cancelled', fulfillment_type: 'pickup' }));
  expect(cancelled.stage).toBe('cancelled');
  expect(cancelled.pickup).toBeNull();
  expect(cancelled.primary).toBeNull();
});

test('portal view-model exposes no admin or personal fields', () => {
  const raw = { ...portalOrder({ status: 'shipped' }), email: 'awa@example.fr', full_name: 'Awa Diallo', notes: 'note interne', total: 64.4, shipping_address: { line1: '12 rue Oberkampf' } } as PortalOrderRow;
  const serialized = JSON.stringify(vm(raw));
  for (const forbidden of ['awa@example.fr', 'Awa Diallo', 'note interne', 'Oberkampf', '64.4', ORDER]) expect(serialized).not.toContain(forbidden);
});

test('support channels: only configured channels, WhatsApp digits, short ref in message', () => {
  const channels = buildSupportChannels({ whatsapp_number: '+33 6 12 34 56 78', legal_email: 'contact@example.com' }, 'CC4314FE', 'https://shop.example.com');
  expect(channels.map((c) => c.kind)).toEqual(['whatsapp', 'email', 'shop']);
  expect(channels[0]!.href).toContain('https://wa.me/33612345678?text=');
  expect(decodeURIComponent(channels[0]!.href)).toContain('#CC4314FE');
  expect(buildSupportChannels({ whatsapp_number: 'abc', legal_email: 'not-an-email' }, 'X', null)).toEqual([]);
});

// ─── Reorder ────────────────────────────────────────────────────────────────

function product(id: string, overrides: Partial<ReorderCatalogProduct> = {}): ReorderCatalogProduct {
  return { id, name: id, slug: id, price: 4.2, image_url: null, weight_grams: 500, stock: 100, storage_type: 'dry', min_order_quantity: 1, order_quantity_step: 1, active: true, ...overrides };
}

test('reorder: current price and pack rules, unavailable and discontinued reported, nothing invalid proposed', () => {
  const proposal = buildReorderProposal([
    { product_id: 'mitoumba', name: 'Mitoumba', quantity: 7 },
    { product_id: 'kaolin', name: 'Kaolin 500 g', quantity: 1 },
    { product_id: 'bobolo', name: 'Bobolo', quantity: 2 },
    { product_id: 'huile', name: 'Huile', quantity: 5 },
    { product_id: null, name: 'Article supprimé', quantity: 1 },
    { product_id: 'gone', name: 'Produit retiré', quantity: 1 },
  ], [
    product('mitoumba', { price: 3.5, min_order_quantity: 4, order_quantity_step: 4 }),
    product('kaolin', { active: false }),
    product('bobolo', { stock: 0 }),
    product('huile', { stock: 3 }),
  ]);
  expect(proposal.lines.map((l) => [l.product.id, l.quantity])).toEqual([['mitoumba', 8], ['huile', 3]]);
  expect(proposal.lines[0]!.product.price).toBe(3.5);
  expect(proposal.lines[0]!.product.min_order_quantity).toBe(4);
  expect(proposal.unavailable.map((u) => [u.name, u.reason])).toEqual([
    ['Article supprimé', 'discontinued'], ['Kaolin 500 g', 'discontinued'], ['bobolo', 'out_of_stock'], ['Produit retiré', 'discontinued'],
  ]);
  expect(proposal.adjusted).toEqual([
    { name: 'mitoumba', from: 7, to: 8, reason: 'minimum' },
    { name: 'huile', from: 5, to: 3, reason: 'stock' },
  ]);
});

test('reorder: only lines of the token order are read — catalogue products not in the order are never added', () => {
  const proposal = buildReorderProposal([{ product_id: 'a', name: 'A', quantity: 1 }], [product('a'), product('b')]);
  expect(proposal.lines.map((l) => l.product.id)).toEqual(['a']);
});
