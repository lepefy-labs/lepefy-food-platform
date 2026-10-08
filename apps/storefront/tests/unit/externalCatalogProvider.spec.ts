import { test, expect } from '@playwright/test';
import { getExternalCatalogProvider } from '../../src/lib/externalCatalog/providers';
import { createGreenApiCatalogProvider, extractGreenApiProducts, readGreenApiConfig, redactSecrets } from '../../src/lib/externalCatalog/providers/greenApi';
import { parseWhatsAppCatalogUrl } from '../../src/lib/externalCatalog/sourceUrl';
import { ExternalCatalogError } from '../../src/lib/externalCatalog/types';

// Risposte HTTP simulate con la forma documentata da GREEN-API (getProducts):
// verificano il connettore, NON costituiscono una lettura reale del catalogo.

const TOKEN = 'abcdef0123456789abcdef0123456789abcdef0123456789ab';
const ENV = { GREEN_API_URL: 'https://7103.api.greenapi.com', GREEN_API_INSTANCE_ID: '7103000001', GREEN_API_TOKEN: TOKEN };
const source = parseWhatsAppCatalogUrl('https://wa.me/c/33612345678');

interface Call { url: string; method: string; body: unknown }

function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> } | Error>) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = queue.shift();
    if (!next) throw new Error('nessuna risposta preparata');
    if (next instanceof Error) throw next;
    const text = next.body === undefined ? '' : typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return new Response(text, { status: next.status, headers: next.headers });
  }) as typeof fetch;
  return { fn, calls };
}

const AUTHORIZED = { status: 200, body: { stateInstance: 'authorized' } };

function product(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, name: `Produit ${id}`, description: '4 paquets de 500g', price: '1200', currency: 'EUR',
    retailer_id: null, is_hidden: false, product_availability: 'IN_STOCK',
    media: { images: [{ id: `img-${id}`, original_image_url: `https://scontent.xx.fbcdn.net/${id}.jpg`, request_image_url: `https://scontent.xx.fbcdn.net/${id}_s.jpg` }], videos: [] },
    url: null, ...extra,
  };
}

const noSleep = async () => undefined;

function provider(responses: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(responses);
  return { p: createGreenApiCatalogProvider(readGreenApiConfig(ENV), { fetch: f.fn, sleep: noSleep }), calls: f.calls };
}

async function catchError(promise: Promise<unknown>): Promise<ExternalCatalogError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ExternalCatalogError);
    return err as ExternalCatalogError;
  }
  throw new Error('errore atteso');
}

test.describe('sorgente', () => {
  test('wa.me/c/<numero> → chatId @c.us', () => {
    expect(parseWhatsAppCatalogUrl('https://wa.me/c/191701838729307')).toEqual({
      url: 'https://wa.me/c/191701838729307', catalogId: '191701838729307', chatId: '191701838729307@c.us',
    });
  });
  test('rifiuta domini e forme non riconosciute', () => {
    for (const bad of ['http://wa.me/c/123456789', 'https://evil.example/c/123456789', 'https://wa.me/33612345678', 'nope']) {
      expect(() => parseWhatsAppCatalogUrl(bad)).toThrow(ExternalCatalogError);
    }
  });
  test('chatId forzato validato', () => {
    expect(parseWhatsAppCatalogUrl('https://wa.me/c/123456789', '191701838729307@lid').chatId).toBe('191701838729307@lid');
    expect(() => parseWhatsAppCatalogUrl('https://wa.me/c/123456789', 'x@g.us')).toThrow(ExternalCatalogError);
  });
});

test.describe('configurazione e autenticazione', () => {
  test('credenziali mancanti: AUTH_MISSING con i soli nomi delle variabili', () => {
    try {
      getExternalCatalogProvider({ GREEN_API_URL: 'https://api.green-api.com' });
      throw new Error('atteso');
    } catch (err) {
      expect((err as ExternalCatalogError).code).toBe('AUTH_MISSING');
      expect((err as Error).message).toContain('GREEN_API_TOKEN');
    }
  });
  test('apiUrl fuori dai domini GREEN-API rifiutato (il token non può partire altrove)', () => {
    expect(() => readGreenApiConfig({ ...ENV, GREEN_API_URL: 'https://attacker.example' })).toThrow(/GREEN_API_URL/);
    expect(() => readGreenApiConfig({ ...ENV, GREEN_API_URL: 'http://7103.api.greenapi.com' })).toThrow(/GREEN_API_URL/);
  });
  test('provider sconosciuto', () => {
    expect(() => getExternalCatalogProvider({ ...ENV, WHATSAPP_CATALOG_PROVIDER: 'scraper' })).toThrow(/sconosciuto/);
  });
  test('401 → AUTH_INVALID', async () => {
    const { p } = provider([{ status: 401, body: 'Unauthorized' }]);
    expect((await catchError(p.fetchProducts(source))).code).toBe('AUTH_INVALID');
  });
  test('istanza non collegata → INSTANCE_NOT_AUTHORIZED, getProducts mai chiamato', async () => {
    const { p, calls } = provider([{ status: 200, body: { stateInstance: 'notAuthorized' } }]);
    expect((await catchError(p.fetchProducts(source))).code).toBe('INSTANCE_NOT_AUTHORIZED');
    expect(calls.map((c) => c.url).some((u) => u.includes('getProducts'))).toBe(false);
  });
  test('istanza bloccata → INSTANCE_UNAVAILABLE', async () => {
    const { p } = provider([{ status: 200, body: { stateInstance: 'blocked' } }]);
    expect((await catchError(p.fetchProducts(source))).code).toBe('INSTANCE_UNAVAILABLE');
  });
});

test.describe('recupero catalogo', () => {
  test('catalogo accessibile: mapping, richiesta e nessun metodo di invio', async () => {
    const { p, calls } = provider([AUTHORIZED, { status: 200, body: { paging: { after: '' }, products: [product('a'), product('b')] } }]);
    const r = await p.fetchProducts(source, { limit: 5 });
    expect(r.products).toHaveLength(2);
    expect(r.truncated).toBe(false);
    expect(r.products[0]).toMatchObject({
      providerProductId: 'a', rawPrice: '1200', currency: 'EUR', availability: 'IN_STOCK',
      images: [{ providerImageId: 'img-a', originalUrl: 'https://scontent.xx.fbcdn.net/a.jpg', previewUrl: 'https://scontent.xx.fbcdn.net/a_s.jpg' }],
    });
    expect(calls[1]).toMatchObject({ method: 'POST', body: { chatId: '33612345678@c.us', productLimit: 5 } });
    expect(calls.every((c) => /\/(getStateInstance|getProducts)\//.test(c.url))).toBe(true);
    expect(r.pages[0]?.body).toBeTruthy();
  });

  test('catalogo inesistente / non consultabile: 400 → CATALOG_UNAVAILABLE', async () => {
    const { p } = provider([AUTHORIZED, { status: 400, body: { message: 'bad request data' } }]);
    const e = await catchError(p.fetchProducts(source));
    expect(e.code).toBe('CATALOG_UNAVAILABLE');
    expect(e.hint).toBeTruthy();
  });

  test('risposta vuota: nessun prodotto + diagnostica', async () => {
    const { p } = provider([AUTHORIZED, { status: 200, body: { paging: { after: '' }, products: [] } }]);
    const r = await p.fetchProducts(source);
    expect(r.products).toEqual([]);
    expect(r.diagnostics.map((d) => d.code)).toContain('EMPTY_CATALOG');
  });

  test('risposta non conforme → UNEXPECTED_RESPONSE', async () => {
    const { p } = provider([AUTHORIZED, { status: 200, body: { foo: 1 } }]);
    expect((await catchError(p.fetchProducts(source))).code).toBe('UNEXPECTED_RESPONSE');
  });

  test('paginazione: cursore presente ma non documentato → truncated, nessun loop', async () => {
    const { p, calls } = provider([AUTHORIZED, { status: 200, body: { paging: { after: 'QVFI' }, products: [product('a')] } }]);
    const r = await p.fetchProducts(source, { limit: 10 });
    expect(r.truncated).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toContain('PAGINATION_CURSOR_UNDOCUMENTED');
    expect(calls).toHaveLength(2);
  });

  test('paginazione: limite raggiunto e prodotti in eccesso scartati', async () => {
    const { p } = provider([AUTHORIZED, { status: 200, body: { paging: { after: 'QVFI' }, products: [product('a'), product('b'), product('c')] } }]);
    const r = await p.fetchProducts(source, { limit: 2 });
    expect(r.products.map((x) => x.providerProductId)).toEqual(['a', 'b']);
    expect(r.diagnostics.map((d) => d.code)).toContain('LIMIT_REACHED');
  });

  test('duplicati e prodotti senza id ignorati con diagnostica', async () => {
    const { p } = provider([AUTHORIZED, { status: 200, body: { paging: { after: '' }, products: [product('a'), product('a'), { name: 'senza id' }] } }]);
    const r = await p.fetchProducts(source);
    expect(r.products).toHaveLength(1);
    expect(r.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['DUPLICATE_PRODUCT', 'PRODUCT_SKIPPED']));
  });
});

test.describe('errori, rate limiting e protezione del token', () => {
  test('429 poi successo: nuovo tentativo con Retry-After', async () => {
    const waits: number[] = [];
    const f = fakeFetch([AUTHORIZED, { status: 429, headers: { 'retry-after': '2' } }, { status: 200, body: { paging: { after: '' }, products: [product('a')] } }]);
    const p = createGreenApiCatalogProvider(readGreenApiConfig(ENV), { fetch: f.fn, sleep: async (ms) => { waits.push(ms); } });
    const r = await p.fetchProducts(source);
    expect(r.products).toHaveLength(1);
    expect(waits).toEqual([2000]);
  });

  test('429 persistente → RATE_LIMITED dopo i tentativi', async () => {
    const { p } = provider([AUTHORIZED, { status: 429 }, { status: 429 }]);
    expect((await catchError(p.fetchProducts(source, { maxRetries: 1 }))).code).toBe('RATE_LIMITED');
  });

  test('466 → QUOTA_EXCEEDED', async () => {
    const { p } = provider([AUTHORIZED, { status: 466, body: { correspondentsStatus: {} } }]);
    expect((await catchError(p.fetchProducts(source))).code).toBe('QUOTA_EXCEEDED');
  });

  test('timeout → TIMEOUT', async () => {
    const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    const { p } = provider([timeout, timeout]);
    expect((await catchError(p.fetchProducts(source, { maxRetries: 1 }))).code).toBe('TIMEOUT');
  });

  test('il token non compare mai nei messaggi d\'errore né nei log', async () => {
    const lines: string[] = [];
    const f = fakeFetch([AUTHORIZED, { status: 400, body: `bad request for /waInstance7103000001/getProducts/${TOKEN}` }]);
    const p = createGreenApiCatalogProvider(readGreenApiConfig(ENV), { fetch: f.fn, sleep: noSleep, log: (l) => lines.push(l) });
    const e = await catchError(p.fetchProducts(source));
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).not.toContain('7103000001');
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  test('rielaborazione da raw salvato: stessa estrazione, nessuna chiamata', () => {
    const r = extractGreenApiProducts([{ paging: { after: 'X' }, products: [product('a'), product('b')] }], 1);
    expect(r.products.map((p) => p.providerProductId)).toEqual(['a']);
    expect(r.truncated).toBe(true);
    expect(() => extractGreenApiProducts([{ nope: true }], 1)).toThrow(ExternalCatalogError);
  });

  test('redactSecrets', () => {
    expect(redactSecrets(`x ${TOKEN} y 7103000001`, { apiToken: TOKEN, idInstance: '7103000001' })).toBe('x [REDACTED_TOKEN] y [INSTANCE]');
  });
});
