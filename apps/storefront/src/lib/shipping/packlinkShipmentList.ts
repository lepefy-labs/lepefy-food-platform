// Read-only listing of the shipments a tenant's Packlink PRO key can see.
//
// Packlink's official connector (packlink-dev/ecommerce_module_core) only
// documents GET shipments/{reference}; the account-wide GET /v1/shipments is
// used by third-party clients but is not officially documented, nor is any
// pagination. The real response carries `pagination { current_page,
// total_pages, total_registers, is_one_indexed }` (observed 2026-09-28: 10
// records per page). Pages are requested with `?page=N` and every page is
// self-verified: a response whose current_page differs from the requested
// page is rejected (`page_not_honored`), never shown as that page. Totals are
// presented as announced by Packlink.
//
// Field names read by summarizePacklinkShipment come first from a real list
// response observed on 2026-09-28 (`{ shipments, pagination }`; per record:
// reference, status, delivery{name,surname,street1,zip_code,city,country},
// parcels[{width,height,length,weight}], weight, parcel_number, carrier,
// service, price, orderDate, collectionDate, canceled, source), then from the
// official DTOs (Shipment.php / Draft.php: packlink_reference, state, to,
// packages, trackings, order_date) as fallbacks. The observed list carries no
// tracking code. Missing fields stay null.

export const PACKLINK_SHIPMENTS_URL = 'https://api.packlink.com/v1/shipments';
export const PACKLINK_LIST_MAX_BYTES = 512_000;
export const PACKLINK_LIST_TIMEOUT_MS = 12_000;
export const PACKLINK_LIST_ROW_LIMIT = 200;
export const PACKLINK_LIST_MAX_PAGE = 10_000;

const SENSITIVE_FIELD = /^(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|token)$/i;
const PAGINATION_KEYS = ['total', 'total_count', 'totalCount', 'count', 'page', 'pages', 'total_pages', 'per_page', 'limit', 'offset', 'next', 'previous', 'prev', 'cursor', 'has_more', 'links', 'meta', 'pagination'];
const ARRAY_CONTAINERS = ['shipments', 'results', 'data'] as const;
const MAX_TEXT = 200;

type JsonRecord = Record<string, unknown>;
export type ArrayContainer = 'root' | (typeof ARRAY_CONTAINERS)[number];

export interface PacklinkPackageSummary {
  weightKg: number | null;
  widthCm: number | null;
  heightCm: number | null;
  lengthCm: number | null;
}

export interface PacklinkShipmentSummary {
  reference: string | null;
  customReference: string | null;
  status: string | null;
  recipientName: string | null;
  recipientCompany: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  carrier: string | null;
  service: string | null;
  content: string | null;
  trackingCodes: string[];
  trackingUrl: string | null;
  createdAt: string | null;
  collectionDate: string | null;
  canceled: boolean | null;
  source: string | null;
  price: number | null;
  currency: string | null;
  parcelCount: number | null;
  totalWeightKg: number | null;
  packages: PacklinkPackageSummary[];
}

export interface LepefyOrderLink {
  id: string;
  label: string;
  status: string | null;
  createdAt: string | null;
}

export interface PacklinkListedShipment {
  summary: PacklinkShipmentSummary;
  lepefyOrder: LepefyOrderLink | null;
  raw: unknown;
}

export interface PacklinkListDiagnostics {
  endpoint: string;
  upstreamStatus: number | null;
  durationMs: number;
  container: ArrayContainer | null;
  responseKeys: string[];
  shipmentFields: string[];
  receivedCount: number | null;
  returnedCount: number;
  truncated: boolean;
  pagination: PacklinkPagination;
  unknownShapeSample?: unknown;
}

export interface PacklinkPagination {
  requestedPage: number;
  // True only when Packlink's own current_page equals the requested page.
  verified: boolean;
  currentPage: number | null;
  totalPages: number | null;
  totalRecords: number | null;
  oneIndexed: boolean | null;
  // Pagination-looking keys exactly as returned (redacted), for diagnostics.
  hints: JsonRecord;
}

export type PacklinkListFailureReason =
  | 'invalid_page'
  | 'page_not_honored'
  | 'provider_not_packlink'
  | 'tenant_api_key_missing'
  | 'packlink_unavailable'
  | 'packlink_unauthorized'
  | 'list_endpoint_not_available'
  | 'packlink_error'
  | 'response_too_large'
  | 'invalid_packlink_response'
  | 'list_response_shape_unknown';

export type PacklinkListResult =
  | {
      available: true;
      source: 'packlink_account';
      queriedAt: string;
      // 'paginated': Packlink confirmed the page and announced its totals.
      completeness: 'paginated' | 'unverified';
      orderLookup: 'ok' | 'error';
      shipments: PacklinkListedShipment[];
      diagnostics: PacklinkListDiagnostics;
    }
  | {
      available: false;
      reason: PacklinkListFailureReason;
      message: string;
      queriedAt: string;
      diagnostics: PacklinkListDiagnostics | null;
    };

export const FAILURE_MESSAGES: Record<PacklinkListFailureReason, string> = {
  invalid_page: 'Numéro de page invalide.',
  page_not_honored: 'Packlink n’a pas renvoyé la page demandée : la pagination n’est pas prise en charge de cette façon. Aucune donnée n’est affichée pour éviter de présenter une autre page.',
  provider_not_packlink: 'Ce tenant n’utilise pas Packlink comme provider de livraison.',
  tenant_api_key_missing: 'Aucune clé API Packlink n’est configurée pour ce tenant.',
  packlink_unavailable: 'Packlink n’a pas répondu (délai dépassé ou erreur réseau).',
  packlink_unauthorized: 'Packlink a refusé la clé API du tenant.',
  list_endpoint_not_available: 'Packlink n’expose pas de liste d’expéditions à cette adresse pour cette clé.',
  packlink_error: 'Packlink a renvoyé une erreur.',
  response_too_large: 'La réponse Packlink dépasse la taille maximale autorisée (512 Ko).',
  invalid_packlink_response: 'La réponse Packlink n’est pas un JSON valide.',
  list_response_shape_unknown: 'La réponse Packlink ne contient pas de liste d’expéditions reconnaissable.',
};

// HTTP status returned by the Lepefy route for each failure.
export const FAILURE_HTTP_STATUS: Record<PacklinkListFailureReason, number> = {
  invalid_page: 400,
  page_not_honored: 502,
  provider_not_packlink: 400,
  tenant_api_key_missing: 409,
  packlink_unavailable: 503,
  packlink_unauthorized: 502,
  list_endpoint_not_available: 501,
  packlink_error: 502,
  response_too_large: 502,
  invalid_packlink_response: 502,
  list_response_shape_unknown: 502,
};

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_TEXT ? `${trimmed.slice(0, MAX_TEXT)}…` : trimmed;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function joinText(...parts: unknown[]): string | null {
  const values = parts.map(text).filter((part): part is string => Boolean(part));
  return values.length ? values.join(' ') : null;
}

export function redactPacklinkValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[nested data omitted]';
  if (typeof value === 'string' && value.length > 2_000) return `${value.slice(0, 2_000)}…`;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => redactPacklinkValue(item, depth + 1));
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_FIELD.test(key))
    .slice(0, 80)
    .map(([key, item]) => [key, redactPacklinkValue(item, depth + 1)]));
}

export function locateShipmentArray(payload: unknown): { array: unknown[]; container: ArrayContainer } | null {
  if (Array.isArray(payload)) return { array: payload, container: 'root' };
  if (!record(payload)) return null;
  for (const key of ARRAY_CONTAINERS) {
    if (Array.isArray(payload[key])) return { array: payload[key] as unknown[], container: key };
  }
  return null;
}

// Reports pagination-looking keys verbatim for the technical diagnostics.
export function paginationHints(payload: unknown): JsonRecord {
  if (!record(payload)) return {};
  return Object.fromEntries(PAGINATION_KEYS
    .filter(key => key in payload)
    .map(key => [key, redactPacklinkValue(payload[key], 6)]));
}

function positiveInt(value: unknown): number | null {
  const parsed = num(value);
  return parsed != null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

// Reads the observed `pagination` object; anything else leaves fields null
// and the page unverified.
export function readPacklinkPagination(payload: unknown, requestedPage: number): PacklinkPagination {
  const meta = record(payload) && record(payload.pagination) ? payload.pagination : {};
  const oneIndexed = typeof meta.is_one_indexed === 'boolean' ? meta.is_one_indexed : null;
  const rawCurrent = positiveInt(meta.current_page);
  // Normalize to 1-based page numbers for the UI.
  const currentPage = rawCurrent == null ? null : oneIndexed === false ? rawCurrent + 1 : rawCurrent;
  const totalPages = positiveInt(meta.total_pages);
  return {
    requestedPage,
    verified: currentPage === requestedPage && totalPages != null,
    currentPage,
    totalPages,
    totalRecords: positiveInt(meta.total_registers),
    oneIndexed,
    hints: paginationHints(payload),
  };
}

// Accepts only a plain decimal page number within bounds; null means invalid.
export function parsePageParam(value: string | null): number | null {
  if (value == null || value === '') return 1;
  if (!/^\d{1,5}$/.test(value)) return null;
  const page = Number(value);
  return page >= 1 && page <= PACKLINK_LIST_MAX_PAGE ? page : null;
}

export function summarizePacklinkShipment(value: unknown): PacklinkShipmentSummary {
  const raw = record(value) ? value : {};
  const to = record(raw.delivery) ? raw.delivery : record(raw.to) ? raw.to : {};
  const packageSource = Array.isArray(raw.parcels) ? raw.parcels : Array.isArray(raw.packages) ? raw.packages : [];
  const carrierObject = record(raw.carrier) ? raw.carrier : null;
  const priceObject = record(raw.price) ? raw.price : null;
  const trackingSource = Array.isArray(raw.trackings) ? raw.trackings
    : Array.isArray(raw.tracking_codes) ? raw.tracking_codes : [];
  const trackingCodes = [
    ...trackingSource.map(text),
    text(raw.carrier_shipment_tracking_number),
  ].filter((code, index, all): code is string => Boolean(code) && all.indexOf(code) === index).slice(0, 10);

  return {
    reference: text(raw.packlink_reference ?? raw.reference ?? raw.shipment_reference),
    customReference: text(raw.shipment_custom_reference),
    status: text(raw.state ?? raw.status ?? raw.status_code),
    recipientName: joinText(to.name, to.surname),
    recipientCompany: text(to.company),
    street: joinText(to.street1, to.street2),
    postalCode: text(to.zip_code ?? to.postalcode ?? to.postal_code),
    city: text(to.city),
    country: text(to.country),
    carrier: text(carrierObject ? carrierObject.name : raw.carrier) ?? text(raw.carrier_name),
    service: text(record(raw.service) ? raw.service.name : raw.service),
    content: text(raw.content),
    trackingCodes,
    trackingUrl: text(raw.tracking_url),
    createdAt: text(raw.orderDate ?? raw.order_date ?? raw.created_at ?? raw.creation_date),
    collectionDate: text(raw.collectionDate ?? raw.collection_date),
    canceled: typeof raw.canceled === 'boolean' ? raw.canceled : null,
    source: text(raw.source),
    price: num(priceObject ? priceObject.base_price ?? priceObject.total_price : raw.price),
    currency: text(raw.currency ?? priceObject?.currency),
    parcelCount: num(raw.parcel_number) ?? (packageSource.length || null),
    totalWeightKg: num(raw.weight),
    packages: packageSource.slice(0, 20).filter(record).map(pkg => ({
      weightKg: num(pkg.weight),
      widthCm: num(pkg.width),
      heightCm: num(pkg.height),
      lengthCm: num(pkg.length),
    })),
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('empty_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > PACKLINK_LIST_MAX_BYTES) {
        await reader.cancel();
        throw new Error('response_too_large');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function orderLabel(orderId: string): string {
  return `#${orderId.slice(0, 8).toUpperCase()}`;
}

export interface ListPacklinkShipmentsInput {
  shippingProvider: string;
  apiKey: string | null | undefined;
  fetchImpl?: typeof fetch;
  // Read-only lookup of tenant orders already linked to these references.
  lookupOrders: (references: string[]) => Promise<Map<string, LepefyOrderLink>>;
  // 1-based page; page 1 is requested without a query parameter.
  page?: number;
  now?: () => number;
}

export async function listPacklinkShipments(input: ListPacklinkShipmentsInput): Promise<PacklinkListResult> {
  const now = input.now ?? Date.now;
  const queriedAt = new Date(now()).toISOString();
  const fail = (reason: PacklinkListFailureReason, diagnostics: PacklinkListDiagnostics | null = null): PacklinkListResult =>
    ({ available: false, reason, message: FAILURE_MESSAGES[reason], queriedAt, diagnostics });

  if (input.shippingProvider !== 'packlink') return fail('provider_not_packlink');
  // Tenant key only: no fallback to the platform-wide key for this listing.
  const apiKey = input.apiKey?.trim();
  if (!apiKey) return fail('tenant_api_key_missing');
  const page = input.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > PACKLINK_LIST_MAX_PAGE) return fail('invalid_page');
  const url = page > 1 ? `${PACKLINK_SHIPMENTS_URL}?page=${page}` : PACKLINK_SHIPMENTS_URL;

  const startedAt = now();
  const diagnostics: PacklinkListDiagnostics = {
    endpoint: `GET ${url}`,
    upstreamStatus: null,
    durationMs: 0,
    container: null,
    responseKeys: [],
    shipmentFields: [],
    receivedCount: null,
    returnedCount: 0,
    truncated: false,
    pagination: readPacklinkPagination(null, page),
  };

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
      method: 'GET',
      headers: { Authorization: apiKey, Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(PACKLINK_LIST_TIMEOUT_MS),
    });
  } catch {
    diagnostics.durationMs = now() - startedAt;
    return fail('packlink_unavailable', diagnostics);
  }
  diagnostics.upstreamStatus = response.status;

  // 404/405 mean enumeration is unavailable for this key/path, not zero shipments.
  if (!response.ok) {
    await response.body?.cancel();
    diagnostics.durationMs = now() - startedAt;
    const reason = response.status === 404 || response.status === 405 ? 'list_endpoint_not_available'
      : response.status === 401 || response.status === 403 ? 'packlink_unauthorized'
      : 'packlink_error';
    return fail(reason, diagnostics);
  }

  let payload: unknown;
  try {
    payload = await readBoundedJson(response);
  } catch (error) {
    diagnostics.durationMs = now() - startedAt;
    const tooLarge = error instanceof Error && error.message === 'response_too_large';
    return fail(tooLarge ? 'response_too_large' : 'invalid_packlink_response', diagnostics);
  }
  diagnostics.durationMs = now() - startedAt;
  diagnostics.responseKeys = record(payload) ? Object.keys(payload).slice(0, 40) : [];
  diagnostics.pagination = readPacklinkPagination(payload, page);

  const located = locateShipmentArray(payload);
  if (!located) {
    diagnostics.unknownShapeSample = redactPacklinkValue(payload, 5);
    return fail('list_response_shape_unknown', diagnostics);
  }

  // Never present another page as the requested one.
  const { currentPage } = diagnostics.pagination;
  if (currentPage != null ? currentPage !== page : page > 1) {
    diagnostics.container = located.container;
    diagnostics.receivedCount = located.array.length;
    return fail('page_not_honored', diagnostics);
  }

  const rows = located.array.slice(0, PACKLINK_LIST_ROW_LIMIT);
  const firstRecord = rows.find(record);
  diagnostics.container = located.container;
  diagnostics.receivedCount = located.array.length;
  diagnostics.returnedCount = rows.length;
  diagnostics.truncated = located.array.length > rows.length;
  diagnostics.shipmentFields = firstRecord ? Object.keys(firstRecord).slice(0, 80) : [];

  const summaries = rows.map(summarizePacklinkShipment);
  const references = Array.from(new Set(summaries
    .map(summary => summary.reference?.toUpperCase())
    .filter((reference): reference is string => Boolean(reference))));

  let orders = new Map<string, LepefyOrderLink>();
  let orderLookup: 'ok' | 'error' = 'ok';
  if (references.length) {
    try {
      orders = await input.lookupOrders(references);
    } catch {
      orderLookup = 'error';
    }
  }

  return {
    available: true,
    source: 'packlink_account',
    queriedAt,
    completeness: diagnostics.pagination.verified ? 'paginated' : 'unverified',
    orderLookup,
    shipments: summaries.map((summary, index) => ({
      summary,
      lepefyOrder: summary.reference ? orders.get(summary.reference.toUpperCase()) ?? null : null,
      raw: redactPacklinkValue(rows[index]),
    })),
    diagnostics,
  };
}
