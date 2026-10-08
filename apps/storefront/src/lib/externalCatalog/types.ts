/**
 * Importazione sperimentale di cataloghi esterni (WhatsApp Business di attività
 * terze) — tipi indipendenti dal provider. Cf. docs/WHATSAPP_EXTERNAL_CATALOG_IMPORT.md.
 *
 * Tre livelli tenuti separati di proposito:
 *   1. dato sorgente  (`RawExternalProduct`, conservato tale e quale nel raw);
 *   2. inferenza      (`NormalizedExternalProduct.suggested_*`, `inference`);
 *   3. dato confermato (`ExternalProductReviewDecision`, scritto solo dalla revisione).
 * Nessun livello sovrascrive l'altro: un valore confermato non viene mai
 * "ricalcolato" da un nuovo parsing, e un'inferenza non diventa mai confermata
 * senza decisione esplicita.
 *
 * Questi moduli NON importano alias `@/` né moduli Next/Supabase: girano sia nel
 * runner dei test unitari sia nella CLI Node (type stripping).
 */

// ─── Sorgente ────────────────────────────────────────────────────────────────

export type ExternalCatalogProviderId = 'green_api';

export interface ExternalCatalogSource {
  /** URL pubblico condiviso dal venditore, es. https://wa.me/c/191701838729307 */
  url: string;
  /** Identificativo estratto dall'URL (cifre dopo /c/). */
  catalogId: string;
  /** chatId del venditore come atteso dal provider (`<cifre>@c.us`). */
  chatId: string;
}

export interface FetchOptions {
  /** Numero massimo di prodotti unici da recuperare. */
  limit?: number;
  /** Timeout per singola richiesta HTTP, in ms. */
  timeoutMs?: number;
  /** Tentativi massimi su 429/502/499/errori di rete. */
  maxRetries?: number;
  /** Leggere anche le collezioni per superare la prima pagina di getProducts (default true). */
  collections?: boolean;
  /** Pausa fra due richieste di catalogo, in ms (limiti WhatsApp). */
  pageDelayMs?: number;
  /** Numero massimo di richieste di catalogo per lettura (state esclusa). */
  maxRequests?: number;
  /** Tempo massimo complessivo della lettura, in ms: oltre, lettura troncata. */
  deadlineMs?: number;
}

/** Immagine così come dichiarata dal provider (nessun download implicito). */
export interface RawExternalImage {
  providerImageId: string | null;
  /** URL ad alta risoluzione — preferito. */
  originalUrl: string | null;
  /** URL di anteprima/miniatura — solo fallback. */
  previewUrl: string | null;
}

/**
 * Prodotto sorgente mappato in forma neutra, SENZA interpretazione: stringhe
 * e valori sono quelli del provider. Il JSON integrale resta nel raw.
 */
export interface RawExternalProduct {
  providerProductId: string;
  name: string | null;
  description: string | null;
  /** Prezzo come ricevuto (stringa nell'unità minima secondo la doc GREEN-API). */
  rawPrice: string | number | null;
  rawSalePrice: string | number | null;
  currency: string | null;
  availability: string | null;
  isHidden: boolean | null;
  retailerId: string | null;
  url: string | null;
  images: RawExternalImage[];
  /** Collezioni del catalogo in cui il prodotto compare (vuoto se letto solo da getProducts). */
  collections?: Array<{ id: string; name: string | null }>;
  /** Posizione nel file raw (pagina, indice) per risalire al dato originale. */
  rawRef: { page: number; index: number };
}

export interface ExternalCatalogPage {
  /** Corpo JSON della risposta, conservato integralmente. */
  body: unknown;
  receivedAt: string;
  /** Provenienza: metodo e collezione della pagina (assenti nei raw precedenti = getProducts). */
  method?: 'getProducts' | 'getCollections' | 'getCollection';
  collectionId?: string | null;
  /** La richiesta portava un cursore (pagina successiva). */
  cursor?: boolean;
}

/**
 * - `complete`: il catalogo sta in una pagina di getProducts (nessun cursore).
 * - `partial`: getProducts e tutte le collezioni letti, ma possono esistere
 *   prodotti fuori dalle collezioni oltre la prima pagina di getProducts.
 * - `truncated`: lettura interrotta (limite, tempo, errore, cursore anomalo).
 * Solo `complete` autorizza a marcare "retiré" i prodotti assenti.
 */
export type ReadCompleteness = 'complete' | 'partial' | 'truncated';

export interface ExternalCatalogReadStats {
  getProductsProducts: number;
  getProductsHasMore: boolean;
  collectionsFound: number;
  collectionPages: number;
  collectionsPagesListed: number;
  productsFromCollections: number;
  duplicatesRemoved: number;
  uniqueProducts: number;
  outsideCollections: number;
  requests: number;
  stopReason: string | null;
}

export interface ExternalCatalogDiagnostic {
  code: string;
  message: string;
}

export interface ExternalCatalogResult {
  provider: ExternalCatalogProviderId;
  source: ExternalCatalogSource;
  fetchedAt: string;
  products: RawExternalProduct[];
  pages: ExternalCatalogPage[];
  /** true se la lettura non è dimostrabilmente completa (= completeness !== 'complete'). */
  truncated: boolean;
  completeness?: ReadCompleteness;
  stats?: ExternalCatalogReadStats;
  diagnostics: ExternalCatalogDiagnostic[];
}

export interface ExternalCatalogProvider {
  readonly id: ExternalCatalogProviderId;
  fetchProducts(source: ExternalCatalogSource, options?: FetchOptions): Promise<ExternalCatalogResult>;
}

export type ExternalCatalogErrorCode =
  | 'AUTH_MISSING'            // credenziali assenti nell'ambiente
  | 'AUTH_INVALID'            // 401/403
  | 'CONFIG_INVALID'          // URL provider non https, provider sconosciuto…
  | 'INSTANCE_NOT_AUTHORIZED' // sessione WhatsApp non collegata (QR non scansionato)
  | 'INSTANCE_UNAVAILABLE'    // starting / blocked / suspended / expired
  | 'SOURCE_INVALID'          // URL catalogo non riconosciuto
  | 'CATALOG_UNAVAILABLE'     // 400 sul chatId: catalogo inesistente o non consultabile
  | 'RATE_LIMITED'            // 429 dopo i tentativi
  | 'QUOTA_EXCEEDED'          // 466 (limite del piano)
  | 'TIMEOUT'
  | 'NETWORK'
  | 'PROVIDER_ERROR'          // 5xx o risposta non conforme
  | 'UNEXPECTED_RESPONSE';

export class ExternalCatalogError extends Error {
  readonly code: ExternalCatalogErrorCode;
  readonly httpStatus: number | null;
  readonly hint: string | null;

  constructor(code: ExternalCatalogErrorCode, message: string, opts: { httpStatus?: number | null; hint?: string | null } = {}) {
    super(message);
    this.name = 'ExternalCatalogError';
    this.code = code;
    this.httpStatus = opts.httpStatus ?? null;
    this.hint = opts.hint ?? null;
  }
}

// ─── Inferenza ───────────────────────────────────────────────────────────────

export type MeasureUnit = 'g' | 'kg' | 'ml' | 'cl' | 'l' | 'unit';

export interface UnitFormat {
  /** null quando l'unità è nota ma la grandezza no (es. "Carton de 12 unités"). */
  value: number | null;
  unit: MeasureUnit;
}

export interface PackageTotal {
  value: number;
  unit: 'g' | 'ml';
}

/**
 * `requires_review`: il testo contiene segnali di quantità/lotto e il modello di
 *   prezzo (lotto vs pezzo con minimo) non è dimostrabile dal testo.
 * `single_item`: nessun segnale di lotto/minimo — un articolo, prezzo per articolo.
 * `unknown`: nessuna informazione utilizzabile (descrizione e nome muti).
 */
export type SellingModel = 'requires_review' | 'single_item' | 'unknown';

export type ExtractionConfidence = 'high' | 'medium' | 'low' | 'none';

export type ReviewReasonCode =
  | 'MIN_INFERRED_FROM_PACKAGE_COUNT'
  | 'MIN_EXPLICIT'
  | 'MIN_IS_MEASURE'
  | 'STEP_EXPLICIT'
  | 'SALE_PACK_SIZE_AMBIGUOUS'
  | 'SINGLE_OUTER_PACKAGE'
  | 'PRICE_MODEL_UNKNOWN'
  | 'CONFLICTING_QUANTITIES'
  | 'CONFLICTING_FORMATS'
  | 'STEP_WITHOUT_MINIMUM'
  | 'NO_DESCRIPTION'
  | 'NO_QUANTITY_SIGNAL'
  | 'PRICE_MISSING'
  | 'PRICE_INVALID'
  | 'CURRENCY_MISSING'
  | 'NAME_MISSING'
  | 'NO_IMAGE'
  | 'PRODUCT_HIDDEN'
  | 'NOT_IN_STOCK';

export interface ReviewReason {
  code: ReviewReasonCode;
  message: string;
}

/** Risultato del motore deterministico (o, in futuro, di un estrattore AI). */
export interface QuantityExtraction {
  package_count: number | null;
  unit_format: UnitFormat | null;
  package_total: PackageTotal | null;
  suggested_min_quantity: number | null;
  suggested_quantity_step: number | null;
  /** Il minimo proviene da una dicitura esplicita ("Minimum 2") e non da un conteggio. */
  min_is_explicit: boolean;
  selling_model: SellingModel;
  confidence: ExtractionConfidence;
  reasons: ReviewReason[];
  /** Frammenti di testo riconosciuti, per spiegare l'inferenza in revisione. */
  matches: string[];
  /** Campo testuale da cui proviene l'inferenza. */
  source_field: 'description' | 'name' | null;
  extractor: string;
}

/**
 * Punto d'estensione per un futuro estrattore AI: deve restituire la stessa
 * forma del motore deterministico e non può mai produrre dati confermati.
 * Nessuna implementazione AI in questo ciclo.
 */
export interface QuantityExtractor {
  readonly id: string;
  extract(input: { name: string | null; description: string | null }): QuantityExtraction | Promise<QuantityExtraction>;
}

export interface NormalizedExternalImage {
  provider_image_id: string | null;
  /** URL scelto (originale se disponibile, altrimenti anteprima). */
  url: string;
  variant: 'original' | 'preview';
  original_url: string | null;
  preview_url: string | null;
  /** Compilati solo dopo lo staging locale. */
  staging?: StagedImageInfo;
}

export interface StagedImageInfo {
  status: 'downloaded' | 'duplicate' | 'expired' | 'rejected' | 'error' | 'skipped';
  sha256: string | null;
  file: string | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  detail: string | null;
  fetched_at: string;
}

export interface NormalizedExternalProduct {
  source_provider: ExternalCatalogProviderId;
  source_catalog_id: string;
  source_product_id: string;
  source_url: string | null;

  original_name: string | null;
  normalized_name: string | null;
  original_description: string | null;

  /** Prezzo mostrato nel catalogo, in unità maggiori (12.00). Mai un prezzo unitario derivato. */
  displayed_price: number | null;
  /** Prezzo promozionale dichiarato dal catalogo (`sale_price`), separato: mai sostituito al prezzo mostrato. */
  sale_price: number | null;
  currency: string | null;
  images: NormalizedExternalImage[];
  product_availability: string | null;

  suggested_min_quantity: number | null;
  suggested_quantity_step: number | null;
  unit_format: UnitFormat | null;
  package_count: number | null;
  package_total_weight: PackageTotal | null;
  selling_model: SellingModel;
  extraction_confidence: ExtractionConfidence;
  review_reasons: ReviewReason[];
  requires_review: boolean;

  inference: Pick<QuantityExtraction, 'matches' | 'source_field' | 'extractor' | 'min_is_explicit'>;
  raw_data_reference: { file: string; page: number; index: number };
}

// ─── Dato confermato (solo artefatti locali in questo ciclo) ────────────────

export type PriceModel = 'per_lot' | 'per_unit' | 'unknown';
export type ReviewStatus = 'pending' | 'confirmed' | 'rejected';

/**
 * Decisione dell'amministratore, separata per quantità minima e modello di
 * prezzo: confermare l'una non implica l'altra.
 */
export interface ExternalProductReviewDecision {
  source_product_id: string;
  status: ReviewStatus;
  min_quantity: number | null;
  min_quantity_confirmed: boolean;
  quantity_step: number | null;
  quantity_step_confirmed: boolean;
  price_model: PriceModel;
  price_model_confirmed: boolean;
  note: string | null;
  updated_at: string;
}
