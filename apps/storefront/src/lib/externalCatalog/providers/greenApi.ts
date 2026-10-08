import type {
  ExternalCatalogDiagnostic,
  ExternalCatalogPage,
  ExternalCatalogProvider,
  ExternalCatalogResult,
  ExternalCatalogSource,
  FetchOptions,
  RawExternalImage,
  RawExternalProduct,
} from '../types';
import { ExternalCatalogError } from '../types';

/**
 * Connettore sperimentale GREEN-API (sessione WhatsApp controllata da Lepefy).
 *
 * Metodi usati, verificati sulla documentazione ufficiale (green-api.com/en/docs):
 *   GET  {apiUrl}/waInstance{id}/getStateInstance/{token}  → { stateInstance }
 *   POST {apiUrl}/waInstance{id}/getProducts/{token}       { chatId, productLimit? }
 *        → { paging: { after }, products: [...] }
 *
 * Vincoli:
 *   - SOLO lettura: la lista `ALLOWED_METHODS` impedisce qualsiasi metodo di
 *     invio (sendMessage, sendProduct, sendOrder…).
 *   - Il token compare solo nel path dell'URL: mai nei log, negli errori o negli
 *     artefatti (`redact`).
 *   - Paginazione NON disponibile: GREEN-API restituisce al massimo 10
 *     prodotti per richiesta (productLimit più alto ignorato) e rifiuta il
 *     cursore `after` ("'after' is not allowed", verificato l'8/10/2026). Se il
 *     provider segnala altre pagine, il risultato è marcato `truncated`.
 *   - WhatsApp può limitare temporaneamente l'API cataloghi su chiamate
 *     frequenti: niente parallelismo, backoff su 429/499/502.
 */

const ALLOWED_METHODS = new Set(['getStateInstance', 'getProducts']);
const ALLOWED_API_HOST_SUFFIXES = ['.green-api.com', '.greenapi.com'];
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 30_000;
/**
 * Tetto di `productLimit` per richiesta. La doc GREEN-API indica solo il default
 * (10), non un massimo: usiamo il massimo che la pipeline accetta (500, come
 * `too_many_items` della RPC 149). La console legge sempre al massimo; se
 * GREEN-API rifiutasse un valore così alto, la lettura fallisce con diagnosi.
 */
export const GREEN_API_MAX_PRODUCT_LIMIT = 500;

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
      const body = await request('getProducts', { body: { chatId: source.chatId, productLimit: limit } }, options);
      const pages: ExternalCatalogPage[] = [{ body, receivedAt: now().toISOString() }];
      const extracted = extractGreenApiProducts(pages.map((pg) => pg.body), limit);
      diagnostics.push(...extracted.diagnostics);
      const { products, truncated } = extracted;

      return { provider: 'green_api', source, fetchedAt, products, pages, truncated, diagnostics };
    },
  };
}

/**
 * Estrae i prodotti dalle risposte `getProducts` (anche rilette da raw/catalog.json):
 * deduplica per id, rispetta il limite, segnala pagine non recuperate.
 */
export function extractGreenApiProducts(bodies: unknown[], limit: number): {
  products: RawExternalProduct[];
  truncated: boolean;
  diagnostics: ExternalCatalogDiagnostic[];
} {
  const diagnostics: ExternalCatalogDiagnostic[] = [];
  const products: RawExternalProduct[] = [];
  const seen = new Set<string>();
  let after = '';
  bodies.forEach((body, page) => {
    const record = asRecord(body);
    if (!record || !Array.isArray(record.products)) {
      throw new ExternalCatalogError('UNEXPECTED_RESPONSE', 'getProducts: campo "products" assente o non è una lista.');
    }
    record.products.forEach((item, index) => {
      const mapped = mapGreenApiProduct(item, page, index);
      if (!mapped) {
        diagnostics.push({ code: 'PRODUCT_SKIPPED', message: `Elemento ${index} senza id: ignorato (resta nel raw).` });
        return;
      }
      if (seen.has(mapped.providerProductId)) {
        diagnostics.push({ code: 'DUPLICATE_PRODUCT', message: `Prodotto ${mapped.providerProductId} duplicato: ignorato.` });
        return;
      }
      seen.add(mapped.providerProductId);
      if (products.length < limit) products.push(mapped);
    });
    after = asString(asRecord(record.paging)?.after) ?? '';
  });

  const truncated = after.length > 0;
  if (truncated) {
    diagnostics.push(products.length >= limit
      ? { code: 'LIMIT_REACHED', message: `Limite di ${limit} prodotti raggiunto: il catalogo contiene altre pagine.` }
      : { code: 'PAGINATION_UNSUPPORTED',
          message: `GREEN-API restituisce al massimo ${products.length} prodotti per richiesta e rifiuta il cursore della pagina successiva ("'after' is not allowed", verificato l'8/10/2026): gli altri prodotti del catalogo non sono leggibili.` });
  }
  if (products.length === 0) {
    diagnostics.push({ code: 'EMPTY_CATALOG', message: 'Il provider ha risposto senza prodotti (catalogo vuoto, nascosto o non consultabile da questa sessione).' });
  }
  return { products, truncated, diagnostics };
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
