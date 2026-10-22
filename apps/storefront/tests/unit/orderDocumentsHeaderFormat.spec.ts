import { test, expect } from '@playwright/test';
import type { Tenant } from '@lepefy/types';
import { ORDER_DOCUMENTS_DEFAULTS } from '../../src/lib/orders/documents/settings';
import {
  buildPackingSlipViewModel, buildPickingListViewModel,
  type DocumentItemRow, type DocumentOrderRow, type DocumentTenant,
} from '../../src/lib/orders/documents/viewModels';
import { citySizeClass, pickingListHtml } from '../../src/lib/orders/documents/pickingListHtml';
import { packingSlipHtml } from '../../src/lib/orders/documents/packingSlipHtml';
import { orderItemFormatLabel } from '../../src/lib/orders/documents/itemFormat';
import { loadOrderDocumentData } from '../../src/lib/orders/documents/loadOrderDocumentData';
import { renderOrderDocuments } from '../../src/lib/orders/documents/renderOrderDocuments';
import { fakeDb, type FakeDb } from './helpers/fakeSupabase';

/**
 * Liste de préparation : en-tête deux colonnes avec encadré CP/ville.
 * Récapitulatif client : format acheté depuis `order_items.format_snapshot` (162).
 */

const ORDER_A = '163835b8-1111-4222-8333-444455556666';
const ORDER_B = 'cc4314fe-9a1b-4c2e-8d77-1f0e5b3a9c21';
const ORDER_OTHER_TENANT = 'aaaaaaaa-1111-4222-8333-444455556666';
const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

type Address = Record<string, unknown>;

function order(id: string, overrides: Partial<DocumentOrderRow> = {}): DocumentOrderRow & { tenant_id: string } {
  return {
    id, tenant_id: TENANT_A, created_at: '2026-10-05T07:14:00Z', status: 'preparing', fulfillment_type: 'delivery',
    full_name: 'Awa Diallo',
    shipping_address: { full_name: 'Awa Diallo', line1: '12 rue Oberkampf', postal_code: '75011', city: 'Paris', country: 'FR' },
    shipping_details: { totalWeightG: 2400 }, shipping_cost: 9.9, total: 30,
    ...overrides,
  };
}

function withAddress(address: Address, overrides: Partial<DocumentOrderRow> = {}) {
  return order(ORDER_A, { shipping_address: address, ...overrides });
}

function item(orderId: string, name: string, overrides: Partial<DocumentItemRow> = {}): DocumentItemRow & { tenant_id: string } {
  return {
    order_id: orderId, tenant_id: TENANT_A, product_id: `p-${name}`, name, name_alt: null, price: 5, quantity: 2, subtotal: 10,
    storage_type: 'dry', warehouse_location: null, ...overrides,
  };
}

const ITEMS = [item(ORDER_A, 'Kaolin'), item(ORDER_A, 'Mitoumba', { quantity: 1, subtotal: 5 })];

function picking(orderRow: DocumentOrderRow, showDeliveryAddress = false) {
  return buildPickingListViewModel({ order: orderRow, items: ITEMS, tenant: { name: 'Chloe Food' }, carton: null, showDeliveryAddress });
}

/** Colonne gauche (identification) et encadré de droite d'une section. */
function headParts(html: string): { left: string; right: string } {
  const head = html.slice(html.indexOf('<div class="pl-head">'), html.indexOf('<div class="pl-section'));
  const split = Math.max(head.indexOf('<div class="pl-dest">'), head.indexOf('<div class="pl-pickup">'));
  return { left: head.slice(0, split), right: head.slice(split) };
}

// ─── A. Liste de préparation : en-tête ──────────────────────────────────────

test('picking header: CP and city in the delivery box, country small, nothing repeated in large on the left', () => {
  for (const format of ['a5', 'a4'] as const) {
    const html = pickingListHtml([picking(order(ORDER_A), true)], format);
    const { left, right } = headParts(html);
    expect(right).toContain('<span class="pl-badge">LIVRAISON</span>');
    expect(right).toContain('<div class="pl-dest-postal">75011</div>');
    expect(right).toContain('<div class="pl-dest-city">Paris</div>');
    expect(right).toContain('<span class="pl-dest-country">FR</span>');
    expect(left).toContain('LISTE DE PRÉPARATION');
    expect(left).toContain('#163835B8');
    expect(left).toContain('<div class="pl-customer">Awa Diallo</div>');
    expect(left).toContain('12 rue Oberkampf');
    expect(left).not.toContain('75011');
    expect(left).not.toContain('Paris');
    expect(html).not.toContain('pl-destination');
  }
  const a5 = pickingListHtml([picking(order(ORDER_A))], 'a5');
  expect(a5).toContain('.format-a5 .pl-dest-postal { font-size: 26pt; }');
  expect(a5).toContain('.format-a5 .pl-dest-city { font-size: 17pt; }');
  expect(a5).toContain('.pl-dest-country { font-size: 9.5pt;');
  expect(a5).toContain('grid-template-columns: minmax(0, 1fr) auto');
});

test('picking header: leading zeros and alphanumeric postal codes kept verbatim', () => {
  const rome = pickingListHtml([picking(withAddress({ line1: 'Via Prenestina 1', postal_code: '00132', city: 'Roma', country: 'IT' }))], 'a5');
  expect(rome).toContain('<div class="pl-dest-postal">00132</div>');
  expect(rome).toContain('<span class="pl-dest-country">IT</span>');
  const london = pickingListHtml([picking(withAddress({ postal_code: 'SW1A 1AA', city: 'London', country: 'GB' }))], 'a5');
  expect(london).toContain('<div class="pl-dest-postal pl-dest-postal--long">SW1A 1AA</div>');
  // Un CP numérique en JSON reste lisible (ses zéros perdus ne sont jamais inventés).
  const numeric = picking(withAddress({ postal_code: 6100, city: 'Bergamo', country: 'IT' }));
  expect(numeric.destinationParts).toEqual({ postalCode: '6100', city: 'Bergamo', country: 'IT' });
});

test('picking header: long cities shrink by steps, never truncated, accents and apostrophes escaped', () => {
  expect(citySizeClass('Paris')).toBe('');
  expect(citySizeClass('Aix-en-Provence')).toBe(' pl-dest-city--long');
  expect(citySizeClass("CASSINA DE' PECCHI")).toBe(' pl-dest-city--very-long');
  expect(citySizeClass('Saint-Rémy-de-Provence-sur-Durance')).toBe(' pl-dest-city--extra-long');
  expect(citySizeClass('Saint-Rémy-de-Provence-sur')).toBe(' pl-dest-city--very-long');
  const html = pickingListHtml([picking(withAddress({ line1: "Via dell'Industria 4", postal_code: '20051', city: "CASSINA DE' PECCHI", country: 'IT' }), true)], 'a5');
  expect(html).toContain('<div class="pl-dest-city pl-dest-city--very-long">CASSINA DE&#39; PECCHI</div>');
  expect(html).toContain('Via dell&#39;Industria 4');
  const long = pickingListHtml([picking(withAddress({ postal_code: '13210', city: 'Saint-Rémy-de-Provence-sur-Durance', country: 'FR' }))], 'a5');
  expect(long).toContain('>Saint-Rémy-de-Provence-sur-Durance</div>');
  expect(long).toContain('overflow-wrap: break-word');
  expect(long).not.toContain('text-overflow');
});

test('picking header: complement and gift recipient kept on the left, all values escaped', () => {
  const vm = picking(withAddress({
    full_name: 'Moussa <b>Traoré</b>', line1: '3 rue Lepic', line2: 'Bât. B & escalier 2', postal_code: '75018', city: 'Paris <i>18e</i>', country: 'FR',
  }, { full_name: 'Awa "Diallo"' }), true);
  const html = pickingListHtml([vm], 'a5');
  const { left, right } = headParts(html);
  expect(left).toContain('Destinataire : Moussa &lt;b&gt;Traoré&lt;/b&gt;');
  expect(left).toContain('Bât. B &amp; escalier 2');
  expect(left).toContain('Awa &quot;Diallo&quot;');
  expect(right).toContain('Paris &lt;i&gt;18e&lt;/i&gt;');
  expect(html).not.toContain('<b>Traoré</b>');
  expect(html).not.toContain('<i>18e</i>');
});

test('picking header: incomplete address degrades without inventing anything', () => {
  const cityOnly = headParts(pickingListHtml([picking(withAddress({ city: 'Lyon' }))], 'a5')).right;
  expect(cityOnly).toContain('<div class="pl-dest-city">Lyon</div>');
  expect(cityOnly).not.toContain('pl-dest-postal');
  expect(cityOnly).not.toContain('pl-dest-country');
  const postalOnly = headParts(pickingListHtml([picking(withAddress({ postal_code: '69002', country: 'FR' }))], 'a5')).right;
  expect(postalOnly).toContain('<div class="pl-dest-postal">69002</div>');
  expect(postalOnly).not.toContain('pl-dest-city');
  for (const address of [{}, null]) {
    const html = pickingListHtml([picking(order(ORDER_A, { shipping_address: address as Address | null }), true)], 'a5');
    expect(headParts(html).right).toContain('Destination non renseignée');
    expect(html).not.toContain('class="pl-address"');
  }
});

test('picking header: pickup orders show no shipping box and no postal code', () => {
  for (const format of ['a5', 'a4'] as const) {
    const vm = picking(order(ORDER_A, { fulfillment_type: 'pickup' }), true);
    expect(vm.destinationParts).toBeNull();
    const html = pickingListHtml([vm], format);
    expect(html).not.toContain('class="pl-dest"');
    expect(html).not.toContain('75011');
    expect(html).toContain('<div class="pl-pickup"><span class="pl-badge">RETRAIT</span><div class="pl-meta">Retrait en boutique</div></div>');
    expect(headParts(html).left).toContain('Awa Diallo');
  }
});

test('picking header: bulk print keeps one header and one box per order, no extra section', () => {
  const vms = [picking(order(ORDER_A)), picking(order(ORDER_B, { shipping_address: { postal_code: '00132', city: 'Roma', country: 'IT' } })), picking(order(ORDER_A, { fulfillment_type: 'pickup' }))];
  for (const format of ['a5', 'a4'] as const) {
    const html = pickingListHtml(vms, format);
    expect(html.match(/<section class="doc">/g)).toHaveLength(3);
    expect(html.match(/<div class="pl-head">/g)).toHaveLength(3);
    expect(html.match(/<div class="pl-dest">/g)).toHaveLength(2);
    expect(html.indexOf('75011')).toBeLessThan(html.indexOf('00132'));
    // Dernière section sans saut de page forcé (pas de feuille blanche finale).
    expect(html).toContain('.doc:last-child { break-after: auto;');
    // L'ancien bloc « Client / Résumé » A4 a disparu : le client est dans l'en-tête.
    expect(html).not.toContain('pl-grid2');
  }
});

// ─── B. Récapitulatif client : format acheté ───────────────────────────────

const DOC_TENANT: DocumentTenant = {
  name: 'Chloe Food', logo_url: null, primary_color: '#0b3d91', currency: 'EUR', storefront_url: 'https://shop.example.com',
  whatsapp_number: null, legal_email: null, android_package_name: null, android_public: false,
};

const snap = (fields: Record<string, unknown>) => ({ v: 1, ...fields });

test('format label: structured grams/kilos, millilitres/litres, packs and sold by the kilo', () => {
  expect(orderItemFormatLabel(snap({ sale_unit: 'sachet', net_content_value: 150, net_content_unit: 'g' }), 'Kaolin')).toBe('150 g');
  expect(orderItemFormatLabel(snap({ net_content_value: '1000.000', net_content_unit: 'g', sale_unit: 'sac' }), 'Riz parfumé')).toBe('1 kg');
  expect(orderItemFormatLabel(snap({ net_content_value: 1.5, net_content_unit: 'kg', sale_unit: 'sac' }), 'Gari')).toBe('1,5 kg');
  expect(orderItemFormatLabel(snap({ sale_unit: 'bouteille', net_content_value: 500, net_content_unit: 'ml' }), 'Bissap')).toBe('500 ml');
  expect(orderItemFormatLabel(snap({ sale_unit: 'bouteille', net_content_value: 1, net_content_unit: 'l' }), 'Huile de palme')).toBe('1 L');
  expect(orderItemFormatLabel(snap({ sale_unit: 'carton', net_content_value: 33, net_content_unit: 'cl', pack_count: 12 }), 'Malta Guinness')).toBe('12 × 33 cl');
  expect(orderItemFormatLabel(snap({ sale_unit: 'kg' }), 'Viande de chèvre')).toBe('Vendu au kilo');
  // Quantité nette libre (018) : lue strictement, sinon telle quelle (texte court).
  expect(orderItemFormatLabel(snap({ net_quantity_display: '500 ml' }), 'Bissap')).toBe('500 ml');
  expect(orderItemFormatLabel(snap({ net_quantity_display: 'Sachet de 5 pièces' }), 'Plantain chips')).toBe('Sachet de 5 pièces');
  expect(orderItemFormatLabel(snap({ net_quantity_display: 'x'.repeat(41) }), 'Plantain chips')).toBeNull();
});

test('format label: never duplicated when the name already says it', () => {
  expect(orderItemFormatLabel(snap({ net_content_value: 150, net_content_unit: 'g' }), 'Kaolin 150g')).toBeNull();
  expect(orderItemFormatLabel(snap({ net_content_value: 500, net_content_unit: 'g' }), 'Kaolin 500 grammes')).toBeNull();
  expect(orderItemFormatLabel(snap({ net_content_value: 1000, net_content_unit: 'ml' }), 'Huile de palme 1 L')).toBeNull();
  expect(orderItemFormatLabel(snap({ net_content_value: 1, net_content_unit: 'kg' }), 'Gari 1000 g')).toBeNull();
  expect(orderItemFormatLabel(snap({ sale_unit: 'carton', net_content_value: 33, net_content_unit: 'cl', pack_count: 12 }), 'Malta 12 x 33 cl')).toBeNull();
  expect(orderItemFormatLabel(snap({ sale_unit: 'carton', net_content_value: 33, net_content_unit: 'cl', pack_count: 12 }), 'Malta 33 cl')).toBe('12 × 33 cl');
  expect(orderItemFormatLabel(snap({ net_quantity_display: 'Sachet de 5 pièces' }), 'Chips (sachet de 5 pièces)')).toBeNull();
  expect(orderItemFormatLabel(snap({ sale_unit: 'kg' }), 'Viande au kilo')).toBeNull();
  // Un autre poids dans le nom n'est pas le même format : affiché.
  expect(orderItemFormatLabel(snap({ net_content_value: 250, net_content_unit: 'g' }), 'Kaolin 500 g')).toBe('250 g');
});

test('format label: legacy lines and unreliable snapshots show nothing', () => {
  for (const raw of [undefined, null, {}, [], 'Format 500 g', { v: 2, net_content_value: 500, net_content_unit: 'g' }, snap({}), snap({ net_content_unit: 'g' }), snap({ sale_unit: 'inconnu' })]) {
    expect(orderItemFormatLabel(raw, 'Kaolin')).toBeNull();
  }
});

test('packing slip: format inline at 10 pt in A5, under the name in A4, escaped, prices unchanged', () => {
  const items = [
    item(ORDER_A, 'Kaolin', { format_snapshot: snap({ sale_unit: 'sachet', net_content_value: 150, net_content_unit: 'g' }), price: 4.5, quantity: 2, subtotal: 9 }),
    item(ORDER_A, 'Épices <maison>', { format_snapshot: snap({ net_quantity_display: 'Pot <b>"200"</b>' }), price: 3, quantity: 1, subtotal: 3 }),
    item(ORDER_A, 'Mitoumba', { price: 5, quantity: 1, subtotal: 5 }),
  ];
  const settings = { ...ORDER_DOCUMENTS_DEFAULTS, packing_slip_show_prices: true };
  const vm = buildPackingSlipViewModel({ order: order(ORDER_A), items, tenant: DOC_TENANT, settings, qr: null });
  expect(vm.items.map((i) => i.format)).toEqual(['150 g', 'Pot <b>"200"</b>', null]);
  expect(vm.items.map((i) => i.lineTotal?.replace(/\s/g, ' '))).toEqual(['9,00 €', '3,00 €', '5,00 €']);
  const legacy = buildPackingSlipViewModel({ order: order(ORDER_A), items: items.map(({ format_snapshot: _, ...rest }) => rest), tenant: DOC_TENANT, settings, qr: null });
  expect(legacy.items.map((i) => i.lineTotal)).toEqual(vm.items.map((i) => i.lineTotal));
  expect(legacy.prices).toEqual(vm.prices);
  // A4 : sous le nom ; A5 : à la suite du nom, insécable (pas de ligne en plus par article).
  const a4 = packingSlipHtml([vm], 'a4');
  expect(a4).toContain('<td>Kaolin<span class="ps-format">Format : 150 g</span></td>');
  expect(a4).toContain('Format : Pot &lt;b&gt;&quot;200&quot;&lt;/b&gt;');
  const a5 = packingSlipHtml([vm], 'a5');
  expect(a5).toContain('<td>Kaolin <span class="ps-format-inline">· 150 g</span></td>');
  expect(a5).toContain('· Pot &lt;b&gt;&quot;200&quot;&lt;/b&gt;');
  expect(a5).toContain('.ps-format-inline { color: #222; white-space: nowrap; }');
  for (const format of ['a5', 'a4'] as const) {
    const html = packingSlipHtml([vm], format);
    expect(html).not.toContain('<b>"200"</b>');
    expect(html).toContain('<td>Mitoumba</td>');
    // Pas de colonne supplémentaire : quantité, article, prix.
    expect(html.match(/<tr>[\s\S]*?<\/tr>/)?.[0].match(/<td/g)).toHaveLength(3);
    expect(packingSlipHtml([legacy], format)).not.toMatch(/ps-format(-inline)?"/);
  }
  expect(a5).toContain('.format-a5 .ps-url, .format-a5 .ps-contact, .format-a5 .ps-alt, .format-a5 .ps-format-inline { font-size: 10pt; }');
});

test('packing slip: assisted/manual lines without product use their own snapshot only', () => {
  const items = [
    item(ORDER_A, 'Colis surprise', { product_id: null, format_snapshot: snap({ net_quantity_display: '2 kg' }) }),
    item(ORDER_A, 'Article libre', { product_id: null }),
  ];
  const vm = buildPackingSlipViewModel({ order: order(ORDER_A), items, tenant: DOC_TENANT, settings: ORDER_DOCUMENTS_DEFAULTS, qr: null });
  expect(vm.items.map((i) => i.format)).toEqual(['2 kg', null]);
});

// ─── Chargement : snapshot historique, catalogue ignoré, isolation ─────────

function slipDb(): FakeDb {
  return fakeDb({
    platform_features: [{ key: 'order_documents' }],
    orders: [order(ORDER_A), { ...order(ORDER_OTHER_TENANT), tenant_id: TENANT_B }],
    order_items: [
      // Snapshot pris à l'achat (150 g) ; la fiche vaut maintenant 250 g.
      item(ORDER_A, 'Kaolin', { product_id: 'p-kaolin', format_snapshot: snap({ sale_unit: 'sachet', net_content_value: 150, net_content_unit: 'g' }) }),
      // Ligne antérieure à la 162 : le format actuel de la fiche n'est jamais utilisé.
      item(ORDER_A, 'Bissap', { product_id: 'p-bissap', format_snapshot: null }),
      { ...item(ORDER_OTHER_TENANT, 'Secret', { format_snapshot: snap({ net_quantity_display: 'Format secret' }) }), tenant_id: TENANT_B },
    ],
    products: [
      { id: 'p-kaolin', tenant_id: TENANT_A, name: 'Kaolin', sale_unit: 'sachet', net_content_value: 250, net_content_unit: 'g', weight_grams: 300 },
      { id: 'p-bissap', tenant_id: TENANT_A, name: 'Bissap', net_quantity_display: '1 L', weight_grams: 1100 },
    ],
    order_public_access_tokens: [],
  });
}

const TENANT = { id: TENANT_A, name: 'Chloe Food', logo_url: null, primary_color: '#0b3d91', currency: 'EUR', storefront_url: 'https://shop.example.com', whatsapp_number: null, legal_email: null, android_package_name: null, android_public: false } as unknown as Tenant;

async function renderSlip(db: FakeDb, orderIds: string[]): Promise<string> {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.GOTENBERG_URL;
  const calls: FormData[] = [];
  process.env.GOTENBERG_URL = 'http://gotenberg.test';
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => { calls.push(init?.body as FormData); return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 }); }) as typeof fetch;
  try {
    await renderOrderDocuments({ db: db as never, tenant: TENANT, kind: 'packing_slip', format: 'a5', settings: ORDER_DOCUMENTS_DEFAULTS, bulk: orderIds.length > 1, orderIds });
    return (calls[0]!.get('files') as Blob).text();
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.GOTENBERG_URL; else process.env.GOTENBERG_URL = previousUrl;
  }
}

test('render: historical format printed even after the product changed; legacy lines never read the catalogue', async () => {
  const html = await renderSlip(slipDb(), [ORDER_A]);
  expect(html).toContain('· 150 g');
  expect(html).not.toContain('250 g');
  expect(html).toContain('<td>Bissap</td>');
  expect(html).not.toContain('1 L');
});

test('render: tenant isolation — another tenant\'s line and format never reach the document', async () => {
  const html = await renderSlip(slipDb(), [ORDER_A, ORDER_OTHER_TENANT]);
  expect(html).not.toContain('Secret');
  expect(html).not.toContain('Format secret');
  expect(html.match(/<section class="doc ps">/g)).toHaveLength(1);
});

test('loader: without migration 162 the slip is still printed, without format', async () => {
  const db = slipDb();
  const original = db.from.bind(db);
  const missing = { code: '42703', message: 'column order_items.format_snapshot does not exist' };
  const failing = {
    eq() { return failing; }, in() { return failing; },
    then(resolve: (value: { data: null; error: typeof missing }) => unknown) { return Promise.resolve({ data: null, error: missing }).then(resolve); },
  };
  const selects: string[] = [];
  db.from = (table: string) => {
    const query = original(table);
    if (table !== 'order_items') return query;
    const select = query.select.bind(query);
    (query as unknown as { select: (columns?: string) => unknown }).select = (columns?: string) => {
      selects.push(columns ?? '');
      return columns?.includes('format_snapshot') ? failing : select(columns);
    };
    return query;
  };
  const loaded = await loadOrderDocumentData(db as never, { tenantId: TENANT_A, orderIds: [ORDER_A], mode: 'packing' });
  expect(loaded.orders[0]!.items.map((i) => i.name)).toEqual(['Kaolin', 'Bissap']);
  // Première lecture avec le snapshot refusée, relecture avec les colonnes historiques.
  expect(selects).toHaveLength(2);
  expect(selects[0]).toContain('format_snapshot');
  expect(selects[1]).not.toContain('format_snapshot');
  const html = await renderSlip(db, [ORDER_A]);
  expect(html).toContain('RÉCAPITULATIF DE COMMANDE');
  // Picking : même lecture (snapshot puis repli), la liste reste imprimable sans la 162.
  selects.length = 0;
  const picking = await loadOrderDocumentData(db as never, { tenantId: TENANT_A, orderIds: [ORDER_A], mode: 'picking' });
  expect(picking.orders[0]!.items).toHaveLength(2);
  expect(selects).toHaveLength(2);
  expect(selects[0]).toContain('format_snapshot');
  expect(selects[1]).not.toContain('format_snapshot');
});

test('picking list: purchased format from the order line, catalogue weight only without snapshot, never both', () => {
  const weights = new Map([['p-Arachides frais', 1000], ['p-Mitoumba', 750], ['p-Kaolin 500 g', 500], ['p-Bissap', 300]]);
  const items: DocumentItemRow[] = [
    // Catalogue now says 1 kg, the customer bought what the line recorded.
    item(ORDER_A, 'Arachides frais', { format_snapshot: snap({ net_quantity_display: '2 kg' }) }),
    item(ORDER_A, 'Mitoumba', { format_snapshot: snap({ sale_unit: 'sachet', net_content_value: 150, net_content_unit: 'g' }) }),
    // Format already in the name: neither format nor weight.
    item(ORDER_A, 'Kaolin 500 g', { format_snapshot: snap({ net_quantity_display: '500 g' }) }),
    // Legacy line / product without format: catalogue weight fallback.
    item(ORDER_A, 'Bissap', { format_snapshot: null }),
    item(ORDER_A, 'Épices <maison>', { product_id: null, format_snapshot: snap({ net_quantity_display: 'Pot <b>"200"</b>' }) }),
  ];
  const vm = buildPickingListViewModel({ order: order(ORDER_A), items, tenant: { name: 'T' }, carton: null, productWeights: weights });
  const line = (name: string) => vm.items.find((i) => i.name === name)!;
  expect(line('Arachides frais')).toMatchObject({ format: '2 kg', catalogueWeight: null });
  expect(line('Mitoumba')).toMatchObject({ format: '150 g', catalogueWeight: null });
  expect(line('Kaolin 500 g')).toMatchObject({ format: null, catalogueWeight: null });
  expect(line('Bissap')).toMatchObject({ format: null, catalogueWeight: '300 g' });
  for (const format of ['a5', 'a4'] as const) {
    const html = pickingListHtml([vm], format);
    expect(html).toContain('Format : 2 kg');
    expect(html).toContain('Format : 150 g');
    expect(html).toContain('Poids catalogue : 300 g');
    expect(html).not.toContain('Poids catalogue : 1 kg');
    expect(html).not.toContain('Poids catalogue : 750 g');
    expect(html).toContain('Format : Pot &lt;b&gt;&quot;200&quot;&lt;/b&gt;');
    expect(html).not.toContain('<b>"200"</b>');
  }
});
