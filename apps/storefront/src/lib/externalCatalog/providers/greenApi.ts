import type {
  ExternalCatalogDiagnostic,
  ExternalCatalogPage,
  ExternalCatalogProvider,
  ExternalCatalogReadStats,
  ExternalCatalogResult,
  ExternalCatalogSource,
  FetchOptions,
  RawExternalImage,
  RawExternalProduct,
  ReadCompleteness,
} from '../types';
import { ExternalCatalogError } from '../types';

/**
 * Connettore sperimentale GREEN-API (sessione WhatsApp controllata da Lepefy).
 *
 * Metodi usati, verificati sulla documentazione ufficiale (green-api.com/en/docs)
 * e su un catalogo reale (8/10/2026):
 *   GET  …/getStateInstance/{token}   → { stateInstance }
 *   POST …/getProducts/{token}        { chatId, productLimit? }
 *        → { paging: { after }, products }  max 10 prodotti, nessuna pagina
 *          successiva ("'after' is not allowed")
 *   POST …/getCollections/{token}     { chatId, collectionLimit?, productLimit?, afterCollectionId? }
 *        → { paging: { after }, collections: [{ id, name, products }] }
 *   POST …/getCollection/{token}      { chatId, collectionId, productLimit?, afterProduct? }
 *        → { paging: { after }, collection: { id, name, products } }
 *
 * Strategia: prima pagina di getProducts e, se il catalogo ha altre pagine,
 * tutte le collezioni con i loro cursori documentati. Il catalogo può contenere
 * prodotti fuori dalle collezioni (verificato: 5 dei primi 10), quindi una
 * lettura così è al massimo `partial`, mai `complete` (`ReadCompleteness`).
 *
 * Vincoli:
 *   - SOLO lettura: `ALLOWED_METHODS` impedisce qualsiasi metodo d'invio
 *     (sendMessage, sendProduct, sendOrder…).
 *   - Il token compare solo nel path dell'URL: mai nei log, negli errori o negli
 *     artefatti (`redact`).
 *   - WhatsApp può limitare l'API cataloghi su chiamate frequenti: richieste in
 *     sequenza con pausa, budget di richieste e di tempo, backoff solo su
 *     429/499/502/503. collectionLimit 50 ha prodotto un HTTP 500 del provider:
 *     si usa 10, il valore della documentazione.
 */

const ALLOWED_METHODS = new Set(['getStateInstance', 'getProducts', 'getCollections', 'getCollection']);
const COLLECTION_PAGE_SIZE = 10;       // collectionLimit verificato (50 → HTTP 500 del provider)
const COLLECTION_PREVIEW_PRODUCTS = 3; // productLimit di getCollections (default documentato)
const COLLECTION_PRODUCTS_PAGE = 10;   // productLimit di getCollection verificato
const MAX_COLLECTION_LIST_PAGES = 30;
const MAX_PAGES_PER_COLLECTION = 60;
const DEFAULT_PAGE_DELAY_MS = 1000;
const DEFAULT_MAX_REQUESTS = 80;
const ALLOWED_API_HOST_SUFFIXES = ['.green-api.com', '.greenapi.com'];
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 30_000;
/**
 * Tetto di prodotti unici per lettura: il massimo che la pipeline accetta (500,
 * come `too_many_items` della RPC 149). getProducts ne restituisce comunque al
 * massimo 10: gli altri arrivano dalle collezioni.
 */
export const GREEN_API_MAX_PRODUCT_LIMIT = 500;

/** Cursore GREEN-API (paging.after): stringa opaca base64/base64url di lunghezza limitata. */
export function validCursor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (v.length === 0 || v.length > 4096) return null;
  return /^[A-Za-z0-9+/=_-]+$/.test(v) ? v : null;
}

export interface GreenApiConfig {
  apiUrl: string;
  idInstance: string;
  apiToken: string;
}

export interface GreenApiDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Traccia sicura (mai il token): metodo, stato HTTP, durata. */
  log?: (line: string) => void;
}

export const GREEN_API_ENV_VARS = ['GREEN_API_URL', 'GREEN_API_INSTANCE_ID', 'GREEN_API_TOKEN'] as const;

/** Legge la configurazione; in caso di assenza elenca i NOMI delle variabili, mai i valori. */
export function readGreenApiConfig(env: Record<string, string | undefined>): GreenApiConfig {
  const missing = GREEN_API_ENV_VARS.filter((k) => !env[k]?.trim());
  if (missing.length > 0) {
    throw new ExternalCatalogError('AUTH_MISSING', `Credenziali GREEN-API assenti: ${missing.join(', ')}.`, {
      hint: 'Configurare un\'istanza GREEN-API collegata a un account WhatsApp controllato da Lepefy (console.green-api.com) e valorizzare le variabili in apps/storefront/.env.local.',
    });
  }
  const apiUrl = (env.GREEN_API_URL as string).trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new ExternalCatalogError('CONFIG_INVALID', 'GREEN_API_URL non è un URL valido.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    parsed.username || parsed.password ||
    (parsed.pathname !== '/' && parsed.pathname !== '') ||
    !ALLOWED_API_HOST_SUFFIXES.some((s) => host.endsWith(s) || host === s.slice(1))
  ) {
    throw new ExternalCatalogError('CONFIG_INVALID',
      'GREEN_API_URL deve essere l\'apiUrl https dell\'istanza (dominio green-api.com / greenapi.com), senza percorso.');
  }
  const idInstance = (env.GREEN_API_INSTANCE_ID as string).trim();
  const apiToken = (env.GREEN_API_TOKEN as string).trim();
  if (!/^\d{4,20}$/.test(idInstance)) {
    throw new ExternalCatalogError('CONFIG_INVALID', 'GREEN_API_INSTANCE_ID deve essere numerico.');
  }
  if (!/^[A-Za-z0-9]{8,200}$/.test(apiToken)) {
    throw new ExternalCatalogError('CONFIG_INVALID', 'GREEN_API_TOKEN ha un formato inatteso.');
  }
  return { apiUrl: `${parsed.protocol}//${parsed.host}`, idInstance, apiToken };
}

/** Rimuove token e id istanza da qualsiasi testo destinato a log/errori/artefatti. */
export function redactSecrets(text: string, config: Pick<GreenApiConfig, 'apiToken' | 'idInstance'>): string {
  let out = text;
  if (config.apiToken) out = out.split(config.apiToken).join('[REDACTED_TOKEN]');
  if (config.idInstance) out = out.split(config.idInstance).join('[INSTANCE]');
  return out;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function mapGreenApiProduct(item: unknown, page: number, index: number): RawExternalProduct | null {
  const p = asRecord(item);
  if (!p) return null;
  const id = typeof p.id === 'string' || typeof p.id === 'number' ? String(p.id).trim() : '';
  if (!id) return null;
  const media = asRecord(p.media);
  const images: RawExternalImage[] = [];
  if (Array.isArray(media?.images)) {
    for (const raw of media.images) {
      const img = asRecord(raw);
      if (!img) continue;
      images.push({
        providerImageId: asString(img.id),
        originalUrl: asString(img.original_image_url),
        previewUrl: asString(img.request_image_url),
      });
    }
  }
  const price = p.price;
  // Dato reale: `sale_price` è un oggetto `{ price, start_date, end_date }`, non una stringa.
  const saleRecord = asRecord(p.sale_price);
  const salePrice = saleRecord ? saleRecord.price : p.sale_price;
  return {
    providerProductId: id,
    name: asString(p.name),
    description: asString(p.description),
    rawPrice: typeof price === 'string' || typeof price === 'number' ? price : null,
    rawSalePrice: typeof salePrice === 'string' || typeof salePrice === 'number' ? salePrice : null,
    currency: asString(p.currency),
    // La doc indica `product_availability`, la risposta reale usa `availability`.
    availability: asString(p.availability) ?? asString(p.product_availability),
    isHidden: typeof p.is_hidden === 'boolean' ? p.is_hidden : null,
    retailerId: asString(p.retailer_id),
    url: asString(p.url),
    images,
    rawRef: { page, index },
  };
}

export function createGreenApiCatalogProvider(config: GreenApiConfig, deps: GreenApiDeps = {}): ExternalCatalogProvider & {
  getInstanceState(options?: FetchOptions): Promise<string>;
} {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);

  function urlFor(method: string): string {
    if (!ALLOWED_METHODS.has(method)) {
      throw new ExternalCatalogError('CONFIG_INVALID', `Metodo GREEN-API non consentito: ${method}.`);
    }
    return `${config.apiUrl}/waInstance${config.idInstance}/${method}/${config.apiToken}`;
  }

  function safe(text: string): string {
    return redactSecrets(text, config).slice(0, 300);
  }

  async function request(method: string, init: { body?: unknown }, options: FetchOptions): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    const url = urlFor(method);
    let lastError: ExternalCatalogError | null = null;
    let lastRetryAfterMs: number | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const wait = Math.min(MAX_RETRY_AFTER_MS, lastRetryAfterMs ?? 1000 * 2 ** (attempt - 1));
        log(`[green-api] ${method} nuovo tentativo ${attempt}/${maxRetries} tra ${wait} ms`);
        await sleep(wait);
      }
      lastRetryAfterMs = null;
      const started = Date.now();
      let res: Response;
      try {
        res = await doFetch(url, {
          method: init.body === undefined ? 'GET' : 'POST',
          headers: init.body === undefined ? { accept: 'application/json' } : { 'content-type': 'application/json', accept: 'application/json' },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
      } catch (err) {
        const name = (err as { name?: string })?.name;
        lastError = name === 'TimeoutError' || name === 'AbortError'
          ? new ExternalCatalogError('TIMEOUT', `GREEN-API ${method}: nessuna risposta entro ${timeoutMs} ms.`)
          : new ExternalCatalogError('NETWORK', `GREEN-API ${method}: errore di rete (${safe(String((err as Error)?.message ?? err))}).`);
        log(`[green-api] ${method} ${lastError.code}`);
        continue;
      }
      log(`[green-api] ${method} HTTP ${res.status} (${Date.now() - started} ms)`);
      const text = await res.text().catch(() => '');

      if (res.ok) {
        if (!text.trim()) return null;
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new ExternalCatalogError('UNEXPECTED_RESPONSE', `GREEN-API ${method}: risposta non JSON.`, { httpStatus: res.status });
        }
      }

      const excerpt = safe(text);
      if (res.status === 429 || res.status === 499 || res.status === 502 || res.status === 503) {
        const retryAfter = Number(res.headers.get('retry-after'));
        lastRetryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null;
        lastError = res.status === 429
          ? new ExternalCatalogError('RATE_LIMITED', `GREEN-API ${method}: troppe richieste (429).`, {
              httpStatus: 429, hint: 'WhatsApp può limitare temporaneamente l\'API cataloghi: riprovare più tardi, senza chiamate ravvicinate.' })
          : new ExternalCatalogError('PROVIDER_ERROR', `GREEN-API ${method}: HTTP ${res.status}.`, { httpStatus: res.status });
        continue;
      }
      throw mapHttpError(method, res.status, excerpt);
    }
    throw lastError ?? new ExternalCatalogError('PROVIDER_ERROR', `GREEN-API ${method}: tentativi esauriti.`);
  }

  async function getInstanceState(options: FetchOptions = {}): Promise<string> {
    const body = asRecord(await request('getStateInstance', {}, options));
    const state = asString(body?.stateInstance);
    if (!state) throw new ExternalCatalogError('UNEXPECTED_RESPONSE', 'getStateInstance: campo stateInstance assente.');
    return state;
  }

  return {
    id: 'green_api',
    getInstanceState,

    async fetchProducts(source: ExternalCatalogSource, options: FetchOptions = {}): Promise<ExternalCatalogResult> {
      const limit = Math.max(1, Math.min(GREEN_API_MAX_PRODUCT_LIMIT, Math.trunc(options.limit ?? 10)));
      const diagnostics: ExternalCatalogDiagnostic[] = [];

      const state = await getInstanceState(options);
      diagnostics.push({ code: 'INSTANCE_STATE', message: `stateInstance = ${state}` });
      if (state === 'notAuthorized') {
        throw new ExternalCatalogError('INSTANCE_NOT_AUTHORIZED', 'L\'istanza GREEN-API non è collegata a un account WhatsApp.', {
          hint: 'Scansionare il QR code dalla console GREEN-API con il numero WhatsApp di Lepefy dedicato ai test.' });
      }
      if (state !== 'authorized') {
        throw new ExternalCatalogError('INSTANCE_UNAVAILABLE', `Istanza GREEN-API non utilizzabile (stateInstance = ${state}).`);
      }

      const fetchedAt = now().toISOString();
      const startedAt = Date.now();
      const pageDelay = Math.max(0, options.pageDelayMs ?? DEFAULT_PAGE_DELAY_MS);
      const maxRequests = Math.max(1, options.maxRequests ?? DEFAULT_MAX_REQUESTS);
      const deadline = options.deadlineMs ? startedAt + options.deadlineMs : Number.POSITIVE_INFINITY;
      const pages: ExternalCatalogPage[] = [];
      let requests = 0;
      let stopReason: string | null = null;

      async function catalogCall(
        method: 'getProducts' | 'getCollections' | 'getCollection',
        body: Record<string, unknown>,
        collectionId: string | null,
        cursor: boolean,
      ): Promise<Record<string, unknown> | null> {
        if (requests > 0 && pageDelay > 0) await sleep(pageDelay);
        requests++;
        const response = await request(method, { body }, options);
        pages.push({ body: response, receivedAt: now().toISOString(), method, collectionId, cursor });
        return asRecord(response);
      }
      function budgetExhausted(): string | null {
        if (requests >= maxRequests) return `budget di ${maxRequests} richieste esaurito`;
        if (Date.now() + pageDelay >= deadline) return 'tempo massimo della lettura raggiunto';
        return null;
      }

      // 1. Prima pagina di getProducts: l'unica che vede anche i prodotti fuori dalle collezioni.
      const first = await catalogCall('getProducts', { chatId: source.chatId, productLimit: limit }, null, false);
      if (!first || !Array.isArray(first.products)) {
        throw new ExternalCatalogError('UNEXPECTED_RESPONSE', 'getProducts: campo "products" assente o non è una lista.');
      }
      const getProductsHasMore = (asString(asRecord(first.paging)?.after) ?? '').length > 0;
      let collectionsListed = 0;
      let collectionsRead = false;

      // 2. Collezioni, solo se il catalogo va oltre la prima pagina.
      if (getProductsHasMore && options.collections !== false) {
        try {
          const collectionIds: string[] = [];
          let listCursor: string | null = null;
          let listDone = false;
          const seenListCursors = new Set<string>();
          for (let page = 0; page < MAX_COLLECTION_LIST_PAGES && !stopReason; page++) {
            stopReason = budgetExhausted();
            if (stopReason) break;
            const body: Record<string, unknown> = { chatId: source.chatId, collectionLimit: COLLECTION_PAGE_SIZE, productLimit: COLLECTION_PREVIEW_PRODUCTS };
            if (listCursor) body.afterCollectionId = listCursor;
            const res = await catalogCall('getCollections', body, null, Boolean(listCursor));
            collectionsListed++;
            if (!res || !Array.isArray(res.collections)) {
              throw new ExternalCatalogError('UNEXPECTED_RESPONSE', 'getCollections: campo "collections" assente.');
            }
            for (const c of res.collections) {
              const rec = asRecord(c);
              const id = typeof rec?.id === 'string' || typeof rec?.id === 'number' ? String(rec.id) : null;
              if (id && !collectionIds.includes(id)) collectionIds.push(id);
            }
            const next = nextCursor(res, seenListCursors, 'getCollections', diagnostics);
            if (next.done) { listDone = true; break; }
            if (next.error) { stopReason = next.error; break; }
            listCursor = next.cursor ?? null;
          }
          if (!listDone && !stopReason) stopReason = 'troppe pagine di collezioni';

          // 3. Prodotti di ogni collezione, con afterProduct.
          let allCollectionsDone = listDone;
          for (const collectionId of collectionIds) {
            if (stopReason) { allCollectionsDone = false; break; }
            let productCursor: string | null = null;
            let finished = false;
            const seen = new Set<string>();
            for (let page = 0; page < MAX_PAGES_PER_COLLECTION; page++) {
              stopReason = budgetExhausted();
              if (stopReason) break;
              const body: Record<string, unknown> = { chatId: source.chatId, collectionId, productLimit: COLLECTION_PRODUCTS_PAGE };
              if (productCursor) body.afterProduct = productCursor;
              const res = await catalogCall('getCollection', body, collectionId, Boolean(productCursor));
              if (!res || !asRecord(res.collection)) {
                throw new ExternalCatalogError('UNEXPECTED_RESPONSE', 'getCollection: campo "collection" assente.');
              }
              const next = nextCursor(res, seen, `getCollection ${collectionId}`, diagnostics);
              if (next.done) { finished = true; break; }
              if (next.error) { stopReason = next.error; break; }
              productCursor = next.cursor ?? null;
              if (uniqueProductCount(pages) >= limit) { stopReason = `limite di ${limit} prodotti raggiunto`; break; }
            }
            if (!finished) {
              allCollectionsDone = false;
              if (!stopReason) stopReason = `troppe pagine nella collezione ${collectionId}`;
            }
          }
          collectionsRead = allCollectionsDone && !stopReason;
        } catch (err) {
          const e = err instanceof ExternalCatalogError ? err : new ExternalCatalogError('PROVIDER_ERROR', String((err as Error)?.message ?? err));
          stopReason = `errore del provider sulle collezioni (${e.code})`;
          diagnostics.push({ code: 'COLLECTIONS_FAILED', message: `Lettura delle collezioni interrotta: ${e.message}` });
        }
      }

      const collected = collectGreenApiProducts(pages, limit);
      diagnostics.push(...collected.diagnostics);
      if (collected.limitReached && !stopReason) stopReason = `limite di ${limit} prodotti raggiunto`;
      const completeness: ReadCompleteness = !getProductsHasMore && !collected.limitReached
        ? 'complete'
        : collectionsRead && !collected.limitReached ? 'partial' : 'truncated';
      const stats: ExternalCatalogReadStats = {
        ...collected.stats, getProductsHasMore, collectionsPagesListed: collectionsListed, requests, stopReason,
      };
      diagnostics.push(completenessDiagnostic(completeness, stats, options.collections === false));
      if (collected.products.length === 0) {
        diagnostics.push({ code: 'EMPTY_CATALOG', message: 'Il provider ha risposto senza prodotti (catalogo vuoto, nascosto o non consultabile da questa sessione).' });
      }

      return {
        provider: 'green_api', source, fetchedAt, products: collected.products, pages,
        truncated: completeness !== 'complete', completeness, stats, diagnostics,
      };
    },
  };
}

/** Cursore successivo di una risposta: fine, cursore valido o errore (non valido / ripetuto). */
function nextCursor(
  res: Record<string, unknown>,
  seen: Set<string>,
  label: string,
  diagnostics: ExternalCatalogDiagnostic[],
): { done: true; cursor?: undefined; error?: undefined } | { done: false; cursor: string; error?: undefined } | { done: false; cursor?: undefined; error: string } {
  const raw = asString(asRecord(res.paging)?.after) ?? '';
  if (!raw) return { done: true };
  const cursor = validCursor(raw);
  if (!cursor) {
    diagnostics.push({ code: 'CURSOR_INVALID', message: `${label}: cursore paging.after non valido, lettura interrotta.` });
    return { done: false, error: `cursore non valido (${label})` };
  }
  if (seen.has(cursor)) {
    diagnostics.push({ code: 'CURSOR_REPEATED', message: `${label}: cursore ripetuto, lettura interrotta per evitare un ciclo.` });
    return { done: false, error: `cursore ripetuto (${label})` };
  }
  seen.add(cursor);
  return { done: false, cursor };
}

function completenessDiagnostic(completeness: ReadCompleteness, stats: ExternalCatalogReadStats, collectionsDisabled: boolean): ExternalCatalogDiagnostic {
  if (completeness === 'complete') {
    return { code: 'READ_COMPLETE', message: `Catalogo letto per intero (${stats.uniqueProducts} prodotti in una sola pagina di getProducts).` };
  }
  if (completeness === 'partial') {
    return {
      code: 'READ_PARTIAL',
      message: stats.outsideCollections > 0
        ? `Tutte le ${stats.collectionsFound} collezioni lette, ma ${stats.outsideCollections} dei primi ${stats.getProductsProducts} prodotti non appartengono a nessuna collezione: oltre la prima pagina di getProducts possono esistere altri prodotti fuori dalle collezioni, che GREEN-API non permette di leggere.`
        : `Tutte le ${stats.collectionsFound} collezioni lette; GREEN-API non permette però di verificare che non esistano prodotti fuori dalle collezioni oltre la prima pagina di getProducts.`,
    };
  }
  if (collectionsDisabled && stats.getProductsHasMore) {
    return { code: 'PAGINATION_UNSUPPORTED', message: 'getProducts restituisce al massimo 10 prodotti e rifiuta il cursore ("\'after\' is not allowed"); collezioni non lette.' };
  }
  return { code: 'READ_TRUNCATED', message: `Lettura interrotta: ${stats.stopReason ?? 'motivo sconosciuto'}. I prodotti mancanti non vengono segnati come ritirati.` };
}

function pageItems(page: ExternalCatalogPage): { items: unknown[]; collection: { id: string; name: string | null } | null } {
  const body = asRecord(page.body);
  if (!body) return { items: [], collection: null };
  const method = page.method ?? 'getProducts';
  if (method === 'getCollection') {
    const c = asRecord(body.collection);
    const id = typeof c?.id === 'string' || typeof c?.id === 'number' ? String(c.id) : null;
    return { items: Array.isArray(c?.products) ? c.products : [], collection: id ? { id, name: asString(c?.name) } : null };
  }
  // getCollections: anteprime (3 prodotti), lette per intero con getCollection.
  if (method === 'getCollections') return { items: [], collection: null };
  return { items: Array.isArray(body.products) ? body.products : [], collection: null };
}

function uniqueProductCount(pages: ExternalCatalogPage[]): number {
  const ids = new Set<string>();
  for (const page of pages) {
    for (const item of pageItems(page).items) {
      const id = asRecord(item)?.id;
      if (typeof id === 'string' || typeof id === 'number') ids.add(String(id));
    }
  }
  return ids.size;
}

/**
 * Prodotti unici da tutte le pagine lette (getProducts + getCollection), in
 * ordine di lettura: deduplica per id (vince la prima occorrenza), conserva la
 * provenienza (`rawRef.page` = indice della pagina, che porta metodo e
 * collezione) e l'appartenenza alle collezioni. Usata anche da `--from-raw`
 * (pagine senza `method` = getProducts dei raw precedenti).
 */
export function collectGreenApiProducts(pages: ExternalCatalogPage[], limit: number): {
  products: RawExternalProduct[];
  diagnostics: ExternalCatalogDiagnostic[];
  limitReached: boolean;
  stats: Omit<ExternalCatalogReadStats, 'getProductsHasMore' | 'collectionsPagesListed' | 'requests' | 'stopReason'>;
} {
  const diagnostics: ExternalCatalogDiagnostic[] = [];
  const byId = new Map<string, RawExternalProduct>();
  const order: string[] = [];
  const getProductsIds = new Set<string>();
  const collectionIds = new Set<string>();
  const inCollections = new Set<string>();
  let fromCollections = 0;
  let collectionPages = 0;
  let duplicates = 0;
  let skipped = 0;
  let limitReached = false;

  pages.forEach((page, pageIndex) => {
    const method = page.method ?? 'getProducts';
    const { items, collection } = pageItems(page);
    if (method === 'getCollection') {
      collectionPages++;
      if (collection) collectionIds.add(collection.id);
    }
    items.forEach((item, index) => {
      const mapped = mapGreenApiProduct(item, pageIndex, index);
      if (!mapped) { skipped++; return; }
      const id = mapped.providerProductId;
      if (method === 'getProducts') getProductsIds.add(id);
      else { fromCollections++; inCollections.add(id); }
      const existing = byId.get(id);
      if (existing) {
        duplicates++;
        if (collection && !existing.collections?.some((c) => c.id === collection.id)) {
          existing.collections = [...(existing.collections ?? []), collection];
        }
        return;
      }
      if (order.length >= limit) { limitReached = true; return; }
      mapped.collections = collection ? [collection] : [];
      byId.set(id, mapped);
      order.push(id);
    });
  });

  if (skipped > 0) diagnostics.push({ code: 'PRODUCT_SKIPPED', message: `${skipped} elemento/i senza id ignorato/i (restano nel raw).` });
  if (duplicates > 0) diagnostics.push({ code: 'DUPLICATES_REMOVED', message: `${duplicates} occorrenza/e duplicata/e eliminata/e (stesso prodotto in getProducts e/o in più collezioni).` });
  if (limitReached) diagnostics.push({ code: 'LIMIT_REACHED', message: `Limite di ${limit} prodotti unici raggiunto.` });

  return {
    products: order.map((id) => byId.get(id) as RawExternalProduct),
    diagnostics,
    limitReached,
    stats: {
      getProductsProducts: getProductsIds.size,
      collectionsFound: collectionIds.size,
      collectionPages,
      productsFromCollections: fromCollections,
      duplicatesRemoved: duplicates,
      uniqueProducts: order.length,
      outsideCollections: [...getProductsIds].filter((id) => !inCollections.has(id)).length,
    },
  };
}

function mapHttpError(method: string, status: number, excerpt: string): ExternalCatalogError {
  const lower = excerpt.toLowerCase();
  if (status === 401 || status === 403) {
    return new ExternalCatalogError('AUTH_INVALID', `GREEN-API ${method}: autenticazione rifiutata (HTTP ${status}).`, {
      httpStatus: status, hint: 'Verificare GREEN_API_INSTANCE_ID, GREEN_API_TOKEN e GREEN_API_URL dell\'istanza.' });
  }
  if (status === 466) {
    return new ExternalCatalogError('QUOTA_EXCEEDED', `GREEN-API ${method}: limite del piano esaurito (466).`, {
      httpStatus: status, hint: 'Il piano Developer limita i corrispondenti/chiamate mensili: verificare la console GREEN-API.' });
  }
  if (status === 400) {
    if (lower.includes('not authorized')) {
      return new ExternalCatalogError('INSTANCE_NOT_AUTHORIZED', `GREEN-API ${method}: istanza non autorizzata.`, { httpStatus: status });
    }
    if (lower.includes('starting') || lower.includes('expired') || lower.includes('deleted')) {
      return new ExternalCatalogError('INSTANCE_UNAVAILABLE', `GREEN-API ${method}: istanza non disponibile (${excerpt}).`, { httpStatus: status });
    }
    return new ExternalCatalogError('CATALOG_UNAVAILABLE', `GREEN-API ${method}: richiesta rifiutata (HTTP 400: ${excerpt || 'nessun dettaglio'}).`, {
      httpStatus: status,
      hint: 'Il numero potrebbe non essere un account WhatsApp Business con catalogo pubblico, oppure il chatId non è valido.' });
  }
  if (status >= 500) {
    return new ExternalCatalogError('PROVIDER_ERROR', `GREEN-API ${method}: errore del provider (HTTP ${status}).`, { httpStatus: status });
  }
  return new ExternalCatalogError('PROVIDER_ERROR', `GREEN-API ${method}: HTTP ${status} inatteso.`, { httpStatus: status });
}
