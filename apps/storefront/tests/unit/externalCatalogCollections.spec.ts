import { test, expect } from '@playwright/test';
import { createGreenApiCatalogProvider, readGreenApiConfig, validCursor } from '../../src/lib/externalCatalog/providers/greenApi';
import { buildRunReport } from '../../src/lib/externalCatalog/report';
import { parseWhatsAppCatalogUrl } from '../../src/lib/externalCatalog/sourceUrl';

// Lettura per collezioni (getCollections / getCollection) con risposte SIMULATE
// nella forma osservata sul catalogo reale l'8/10/2026. Non è una lettura reale.

const TOKEN = 'abcdef0123456789abcdef0123456789abcdef0123456789ab';
const ENV = { GREEN_API_URL: 'https://7103.api.greenapi.com', GREEN_API_INSTANCE_ID: '7103000001', GREEN_API_TOKEN: TOKEN };
const source = parseWhatsAppCatalogUrl('https://wa.me/c/191701838729307', '393296958822@c.us');
const AUTHORIZED = { status: 200, body: { stateInstance: 'authorized' } };

type Reply = { status: number; body?: unknown };

function fakeFetch(responses: Reply[]) {
  const calls: Array<{ url: string; body: Record<string, unknown> | undefined }> = [];
  const queue = [...responses];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = queue.shift();
    if (!next) throw new Error('nessuna risposta preparata');
    const text = next.body === undefined ? '' : JSON.stringify(next.body);
    return new Response(text, { status: next.status });
  }) as typeof fetch;
  return { fn, calls };
}

function product(id: string) {
  return {
    id, name: `Produit ${id}`, description: '4 paquets de 500g', price: '12000', currency: 'EUR', availability: 'IN_STOCK',
    media: { images: [{ id: `img-${id}`, original_image_url: `https://media.fna.whatsapp.net/${id}.jpg`, request_image_url: `https://media.fna.whatsapp.net/${id}_s.jpg` }] },
  };
}
const firstPage = (ids: string[], after: string): Reply => ({ status: 200, body: { paging: { after }, products: ids.map(product) } });
const collections = (ids: string[], after: string): Reply => ({
  status: 200, body: { paging: { after }, collections: ids.map((id) => ({ id, name: `Coll ${id}`, status_info: null, products: [] })) },
});
const collection = (id: string, productIds: string[], after: string): Reply => ({
  status: 200, body: { paging: { after }, collection: { id, name: `Coll ${id}`, status_info: null, products: productIds.map(product) } },
});

function provider(responses: Reply[], waits: number[] = []) {
  const f = fakeFetch(responses);
  return { p: createGreenApiCatalogProvider(readGreenApiConfig(ENV), { fetch: f.fn, sleep: async (ms) => { waits.push(ms); } }), calls: f.calls };
}

test('cursori documentati, deduplica, provenienza, pause e completezza parziale', async () => {
  const waits: number[] = [];
  const { p, calls } = provider([
    AUTHORIZED,
    firstPage(['a', 'b'], 'GP1'),
    collections(['1001', '1002'], 'CUR1'),
    collections(['1003'], ''),
    collection('1001', ['a', 'x'], 'P1'),
    collection('1001', ['y'], ''),
    collection('1002', ['z'], ''),
    collection('1003', ['x'], ''),
  ], waits);
  const r = await p.fetchProducts(source, { limit: 500, pageDelayMs: 700 });

  expect(r.products.map((x) => x.providerProductId)).toEqual(['a', 'b', 'x', 'y', 'z']);
  expect(r.completeness).toBe('partial');
  expect(r.truncated).toBe(true);
  expect(r.stats).toMatchObject({
    getProductsProducts: 2, getProductsHasMore: true, collectionsFound: 3, collectionPages: 4, collectionsPagesListed: 2,
    productsFromCollections: 5, duplicatesRemoved: 2, uniqueProducts: 5, outsideCollections: 1, requests: 7, stopReason: null,
  });
  expect(r.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['READ_PARTIAL', 'DUPLICATES_REMOVED']));
  // Nomi dei cursori e limiti verificati sul catalogo reale.
  expect(calls[3]?.body).toMatchObject({ collectionLimit: 10, productLimit: 3, afterCollectionId: 'CUR1' });
  expect(calls[5]?.body).toMatchObject({ collectionId: '1001', productLimit: 10, afterProduct: 'P1' });
  expect(calls.every((c) => /\/(getStateInstance|getProducts|getCollections|getCollection)\//.test(c.url))).toBe(true);
  // Provenienza: y viene dalla 2ª pagina di c1; x appartiene a c1 e c3; b a nessuna collezione.
  const y = r.products.find((x) => x.providerProductId === 'y');
  expect(y && r.pages[y.rawRef.page]).toMatchObject({ method: 'getCollection', collectionId: '1001', cursor: true });
  expect(r.products.find((x) => x.providerProductId === 'x')?.collections?.map((c) => c.id)).toEqual(['1001', '1003']);
  expect(r.products.find((x) => x.providerProductId === 'b')?.collections).toEqual([]);
  // Sequenziale con pausa fra le richieste di catalogo.
  expect(waits).toEqual([700, 700, 700, 700, 700, 700]);
});

test('catalogo in una sola pagina: lettura completa, nessuna collezione', async () => {
  const { p, calls } = provider([AUTHORIZED, firstPage(['a'], '')]);
  const r = await p.fetchProducts(source);
  expect(r.completeness).toBe('complete');
  expect(r.truncated).toBe(false);
  expect(calls).toHaveLength(2);
});

test('collezioni lette senza prodotti fuori collezione: comunque parziale (non verificabile)', async () => {
  const { p } = provider([AUTHORIZED, firstPage(['a'], 'GP1'), collections(['1001'], ''), collection('1001', ['a', 'b'], '')]);
  const r = await p.fetchProducts(source, { pageDelayMs: 0 });
  expect(r.completeness).toBe('partial');
  expect(r.stats?.outsideCollections).toBe(0);
});

test('cursore ripetuto: lettura interrotta e troncata, nessun ciclo', async () => {
  const { p, calls } = provider([
    AUTHORIZED, firstPage(['a'], 'GP1'), collections(['1001'], ''),
    collection('1001', ['x'], 'SAME'), collection('1001', ['y'], 'SAME'),
  ]);
  const r = await p.fetchProducts(source, { pageDelayMs: 0 });
  expect(r.completeness).toBe('truncated');
  expect(r.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['CURSOR_REPEATED', 'READ_TRUNCATED']));
  expect(calls).toHaveLength(5);
  expect(r.products.map((x) => x.providerProductId)).toEqual(['a', 'x', 'y']);
});

test('cursore non valido: lettura interrotta e troncata', async () => {
  const { p } = provider([AUTHORIZED, firstPage(['a'], 'GP1'), collections(['1001'], 'not a cursor!')]);
  const r = await p.fetchProducts(source, { pageDelayMs: 0 });
  expect(r.completeness).toBe('truncated');
  expect(r.diagnostics.map((d) => d.code)).toContain('CURSOR_INVALID');
});

test('errore del provider sulle collezioni: prodotti di getProducts conservati, lettura troncata', async () => {
  const { p } = provider([AUTHORIZED, firstPage(['a', 'b'], 'GP1'), { status: 500, body: { message: 'write EPROTO' } }]);
  const r = await p.fetchProducts(source, { pageDelayMs: 0 });
  expect(r.products.map((x) => x.providerProductId)).toEqual(['a', 'b']);
  expect(r.completeness).toBe('truncated');
  expect(r.diagnostics.map((d) => d.code)).toContain('COLLECTIONS_FAILED');
  expect(JSON.stringify(r.diagnostics)).not.toContain(TOKEN);
});

test('budget di richieste rispettato: lettura troncata', async () => {
  const { p, calls } = provider([AUTHORIZED, firstPage(['a'], 'GP1'), collections(['1001', '1002'], ''), collection('1001', ['x'], '')]);
  const r = await p.fetchProducts(source, { pageDelayMs: 0, maxRequests: 3 });
  expect(r.completeness).toBe('truncated');
  expect(r.stats?.requests).toBe(3);
  expect(r.stats?.stopReason).toMatch(/budget/);
  expect(calls).toHaveLength(4);
});

test('tempo massimo: lettura troncata invece di superare il limite della route', async () => {
  const { p } = provider([AUTHORIZED, firstPage(['a'], 'GP1'), collections(['1001'], '')]);
  const r = await p.fetchProducts(source, { pageDelayMs: 50, deadlineMs: 1 });
  expect(r.completeness).toBe('truncated');
  expect(r.stats?.stopReason).toMatch(/tempo/);
});

test('limite di prodotti unici: lettura troncata', async () => {
  const { p } = provider([AUTHORIZED, firstPage(['a'], 'GP1'), collections(['1001'], ''), collection('1001', ['x', 'y'], 'P1')]);
  const r = await p.fetchProducts(source, { pageDelayMs: 0, limit: 2 });
  expect(r.products.map((x) => x.providerProductId)).toEqual(['a', 'x']);
  expect(r.completeness).toBe('truncated');
});

test('validCursor accetta i cursori reali e rifiuta il resto', () => {
  expect(validCursor('Cg8QZXhjbHVkZV9pdGVtX2lkcxQCCggAZq5eXEV+LQgAZO89Ak+PA==')).not.toBeNull();
  expect(validCursor('AQHTM1OWaud1RlJ4xT6Vv7_iizTog0d67hCZpgpCbz4_kzF--fmc')).not.toBeNull();
  for (const bad of ['', '   ', 'a b', 'x"y', 'x'.repeat(5000), 42, null]) expect(validCursor(bad)).toBeNull();
});

test('report: sezione di lettura e dati non recuperabili per una lettura parziale', () => {
  const r = buildRunReport({
    generatedAt: 't', status: 'success', provider: 'green_api', sourceUrl: null, chatId: null,
    options: { limit: 500, dry_run: false, images: true }, products: [], truncated: true, completeness: 'partial',
    readStats: {
      getProductsProducts: 10, getProductsHasMore: true, collectionsFound: 17, collectionPages: 20, collectionsPagesListed: 2,
      productsFromCollections: 94, duplicatesRemoved: 6, uniqueProducts: 98, outsideCollections: 5, requests: 23, stopReason: null,
    },
    diagnostics: [],
  });
  expect(r.read).toMatchObject({ completeness: 'partial', collections_found: 17, unique_products: 98, duplicates_removed: 6, outside_collections: 5 });
  expect(r.unrecoverable_data.join(' ')).toContain('fuori dalle collezioni');
});

// ─── Lettura a riprese (console: blocchi da 40 s) e resilienza ───────────────

test('lettura a riprese: il secondo blocco riprende da collezione e cursore, senza rileggere stato né getProducts', async () => {
  const first = provider([
    AUTHORIZED, firstPage(['a'], 'GP1'), collections(['1001', '1002'], ''), collection('1001', ['x'], 'P1'),
  ]);
  const r1 = await first.p.fetchProducts(source, { pageDelayMs: 0, maxRequests: 3 });
  expect(r1.resume).toMatchObject({ v: 1, listDone: true, collectionIds: ['1001', '1002'], collectionIndex: 0, productCursor: 'P1', steps: 1 });
  expect(r1.completeness).toBe('truncated');
  expect(r1.diagnostics.map((d) => d.code)).toContain('READ_IN_PROGRESS');

  const second = provider([collection('1001', ['y'], ''), collection('1002', ['z'], '')]);
  const r2 = await second.p.fetchProducts(source, { pageDelayMs: 0, resume: r1.resume });
  expect(second.calls.map((c) => c.url.match(/\/(\w+)\/[^/]+$/)?.[1])).toEqual(['getCollection', 'getCollection']);
  expect(second.calls[0]?.body).toMatchObject({ collectionId: '1001', afterProduct: 'P1' });
  expect(r2.resume).toBeNull();
  expect(r2.completeness).toBe('partial');
  expect(r2.products.map((x) => x.providerProductId)).toEqual(['y', 'z']);
});

test('stato di ripresa manomesso o incoerente: rifiutato', async () => {
  const { parseReadResume } = await import('../../src/lib/externalCatalog/providers/greenApi');
  const ok = { v: 1, listCursor: null, listDone: true, collectionIds: ['1001', '1002'], collectionIndex: 1, productCursor: 'P1', steps: 2 };
  expect(parseReadResume(ok)).toEqual(ok);
  for (const bad of [
    { ...ok, v: 2 },
    { ...ok, collectionIds: ['1001', 'drop table'] },
    { ...ok, collectionIds: ['1001', '1001'] },
    { ...ok, collectionIndex: 3 },
    { ...ok, productCursor: 'not a cursor!' },
    { ...ok, steps: 0 },
    { ...ok, steps: 30 },
    { ...ok, listDone: false, listCursor: null, collectionIndex: 1 },
    { ...ok, listDone: true, listCursor: 'CUR' },
    null, 'x',
  ]) expect(parseReadResume(bad), JSON.stringify(bad)).toBeNull();
});

test('errore 5xx transitorio del provider: un nuovo tentativo e la lettura prosegue', async () => {
  const waits: number[] = [];
  const { p } = provider([
    AUTHORIZED, firstPage(['a'], 'GP1'),
    { status: 500, body: { message: 'write EPROTO … packet length too long' } },
    collections(['1001'], ''), collection('1001', ['x'], ''),
  ], waits);
  const r = await p.fetchProducts(source, { pageDelayMs: 0, maxRetries: 1 });
  expect(r.completeness).toBe('partial');
  expect(r.products.map((x) => x.providerProductId)).toEqual(['a', 'x']);
  expect(waits).toEqual([1000]);
});

test('errore 5xx persistente: messaggio del provider riportato, senza credenziali', async () => {
  const { p } = provider([
    AUTHORIZED, firstPage(['a'], 'GP1'),
    { status: 500, body: { message: 'write EPROTO' } }, { status: 500, body: { message: 'write EPROTO' } },
  ]);
  const r = await p.fetchProducts(source, { pageDelayMs: 0, maxRetries: 1 });
  const failed = r.diagnostics.find((d) => d.code === 'COLLECTIONS_FAILED');
  expect(failed?.message).toContain('HTTP 500');
  expect(failed?.message).toContain('EPROTO');
  expect(failed?.message).not.toContain(TOKEN);
  expect(r.resume).toBeNull();
});

test('restrizione WhatsApp "Commerce Features Disabled": nessun nuovo tentativo, codice dedicato', async () => {
  const waits: number[] = [];
  const { p, calls } = provider([
    AUTHORIZED, firstPage(['a'], 'GP1'),
    { status: 500, body: '"Commerce Features Disabled Error: Commerce features are not available."' },
  ], waits);
  const r = await p.fetchProducts(source, { pageDelayMs: 0, maxRetries: 3 });
  expect(calls).toHaveLength(3);
  expect(waits).toEqual([]);
  expect(r.products.map((x) => x.providerProductId)).toEqual(['a']);
  expect(r.completeness).toBe('truncated');
  expect(r.diagnostics.map((d) => d.code)).toContain('CATALOG_RESTRICTED');
  expect(r.resume).toBeNull();
});
