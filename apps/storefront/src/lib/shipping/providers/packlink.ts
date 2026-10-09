import { resolvePacklinkApiKey } from '@/lib/shipping/packlinkApiKey';
import {
  ShipmentDraftError, ShippingProviderError,
  type NormalizedShipmentStatus, type ProviderShipmentDraftInput, type ProviderShipmentSnapshot, type ShippingProviderAdapter,
  type ShippingProviderContext,
} from './types';

const BASE = 'https://api.packlink.com/v1';
const MAX_BYTES = 256_000;
const text = (value: unknown, max = 160): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function normalizePacklinkStatus(raw: string | null): NormalizedShipmentStatus {
  const code = raw?.toUpperCase() ?? '';
  if (code === 'READY_FOR_COLLECTION') return 'ready_for_collection';
  if (code === 'IN_TRANSIT') return 'in_transit';
  if (code.startsWith('OUT_FOR_DELIVERY')) return 'out_for_delivery';
  if (code === 'DELIVERED') return 'delivered';
  if (code === 'CANCELLED' || code === 'CANCELED') return 'cancelled';
  if (code === 'RETURNED' || code === 'RETURNED_TO_SENDER') return 'returned';
  if (['EXCEPTION', 'INCIDENT', 'DELIVERY_FAILED'].includes(code)) return 'exception';
  // Pre-collection Packlink PRO states (draft, awaiting payment, label to print).
  if (['PENDING', 'DRAFT', 'PROCESSING', 'AWAITING_COMPLETION', 'READY_TO_PURCHASE', 'READY_TO_PRINT', 'CARRIER_PENDING'].includes(code)) return 'pending';
  return 'unknown';
}

const PROGRESS_RANK: Partial<Record<NormalizedShipmentStatus, number>> = {
  pending: 0, ready_for_collection: 1, in_transit: 2, out_for_delivery: 2, delivered: 3,
};

export function resolveTrackingUrl(raw: unknown, trackingCode: string | null): string | null {
  const template = text(raw, 2048);
  if (!template) return null;
  const placeholder = /\[tracking\]|%5Btracking%5D/gi;
  if (placeholder.test(template) && !trackingCode) return null;
  const resolved = template.replace(/\[tracking\]|%5Btracking%5D/gi, encodeURIComponent(trackingCode ?? ''));
  try {
    const url = new URL(resolved);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

function date(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const formatted = /^\d{4}\/\d{2}\/\d{2}$/.test(raw) ? raw.replaceAll('/', '-') + 'T00:00:00Z' : raw;
  const timestamp = Date.parse(formatted);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function parsePacklinkShipment(reference: string, payload: unknown, timeline: unknown): ProviderShipmentSnapshot {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(timeline)) {
    throw new ShippingProviderError('shipment_payload_invalid');
  }
  const shipment = object(payload);
  // A JSON error object returned with HTTP 200 is not a shipment.
  if (!['reference', 'shipment_reference', 'carrier_product_id', 'carrier_shipment_tracking_number', 'trackings', 'status', 'state'].some(key => key in shipment)
    || shipment.error || shipment.errors) throw new ShippingProviderError('shipment_payload_invalid');
  const suppliedReference = text(shipment.reference ?? shipment.shipment_reference);
  if (suppliedReference && suppliedReference !== reference) throw new ShippingProviderError('shipment_reference_mismatch');
  const fallback = Array.isArray(shipment.trackings) ? shipment.trackings.find(value => typeof value === 'string' && value.trim()) : null;
  const trackingCode = text(shipment.carrier_shipment_tracking_number) ?? text(fallback);
  const events = timeline.flatMap(value => {
    const event = object(value);
    const providerStatus = text(event.status_code);
    const description = text(event.description, 400);
    const occurredAt = typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)
      && event.timestamp > 0 && event.timestamp < 253402300800
      ? new Date(event.timestamp * 1000).toISOString() : date(event.timestamp);
    if (!occurredAt || !description) return [];
    return [{ occurredAt, description, providerStatus, status: normalizePacklinkStatus(providerStatus) }];
  }).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).slice(-100);
  // Carriers emit late administrative events (BRT "DATI SPEDIZ. TRASMESSI" -> READY_FOR_COLLECTION
  // after "PARTITA"): a forward-progress event never moves the shipment back behind one already reached.
  const latest = events.reduce<(typeof events)[number] | undefined>((current, event) => {
    const rank = PROGRESS_RANK[event.status], best = current ? PROGRESS_RANK[current.status] : undefined;
    return rank !== undefined && best !== undefined && rank < best ? current : event;
  }, undefined);
  // Packlink PRO exposes the shipment status as `state` (e.g. READY_TO_PRINT).
  const providerStatus = latest?.providerStatus ?? text(shipment.state ?? shipment.status_code ?? shipment.status);
  const product = text(shipment.carrier_product_id);
  const carrierObject = object(shipment.carrier);
  const carrier = text(shipment.carrier_name) ?? text(carrierObject.name) ?? text(shipment.carrier)
    ?? (product?.split('_').filter(Boolean)[1] || null);
  return {
    provider: 'packlink', providerReference: reference, carrier, trackingCode,
    trackingUrl: resolveTrackingUrl(shipment.tracking_url, trackingCode),
    estimatedDeliveryAt: date(shipment.estimated_delivery_date), providerStatus,
    normalizedStatus: normalizePacklinkStatus(providerStatus), events,
  };
}

async function request(apiKey: string, path: string): Promise<unknown> {
  try {
    const response = await fetch(BASE + path, {
      headers: { Authorization: apiKey, Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ShippingProviderError(response.status === 404 ? 'shipment_not_found' : 'shipping_provider_unavailable');
    }
    if (!response.body) throw new ShippingProviderError('shipment_payload_invalid');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > MAX_BYTES) { await reader.cancel(); throw new ShippingProviderError('shipment_payload_too_large'); }
      chunks.push(result.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof ShippingProviderError) throw error;
    throw new ShippingProviderError('shipping_provider_unavailable');
  }
}

function tenantApiKey(context: ShippingProviderContext): string | null {
  return resolvePacklinkApiKey({ packlink_api_key: text(context.tenant.packlink_api_key, 4096), is_test: context.tenant.is_test === true });
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.length;
    if (size > MAX_BYTES) { await reader.cancel(); return null; }
    chunks.push(result.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; } catch { return null; }
}

export interface PacklinkAddress {
  name: string; surname: string | null; company: string | null; street1: string; street2: string | null;
  zip_code: string; city: string; country: string; phone: string | null; email: string | null;
}

/**
 * Sender = the account's default Packlink PRO warehouse (official connector:
 * GET clients/warehouses, `default_selection`). A single warehouse counts as
 * default. `postal_code` may be "<code> - <city>" (Warehouse::fromArray).
 */
export function selectPacklinkWarehouse(payload: unknown): PacklinkAddress | null {
  const list = Array.isArray(payload) ? payload : Array.isArray(object(payload).warehouses) ? object(payload).warehouses as unknown[] : [];
  const warehouses = list.map(object);
  const chosen = warehouses.find(row => row.default_selection === true) ?? (warehouses.length === 1 ? warehouses[0] : undefined);
  if (!chosen) return null;
  let zip = text(chosen.postal_code ?? chosen.zip_code, 40);
  let city = text(chosen.city, 80);
  const split = zip ? /^(.+?)\s+-\s+(.+)$/.exec(zip) : null;
  if (split) { zip = split[1]!.trim(); city = city ?? split[2]!.trim(); }
  const country = text(chosen.country, 2)?.toUpperCase() ?? null;
  const street1 = text(chosen.address ?? chosen.street1, 120);
  const name = text(chosen.name, 80) ?? text(chosen.company, 80);
  if (!zip || !city || !country || !street1 || !name) return null;
  return {
    name, surname: text(chosen.surname, 80), company: text(chosen.company, 80), street1, street2: null,
    zip_code: zip, city, country, phone: text(chosen.phone, 40), email: text(chosen.email, 160),
  };
}

/** Pure payload builder (Draft.php keys); no service_id: the service is chosen and purchased in Packlink PRO. */
export function buildPacklinkDraftPayload(from: PacklinkAddress, input: ProviderShipmentDraftInput): Record<string, unknown> {
  const r = input.recipient;
  const compact = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== ''));
  return {
    from: compact({ ...from }),
    to: compact({
      name: r.firstName, surname: r.lastName, street1: r.street1, street2: r.street2,
      zip_code: r.postalCode, city: r.city, country: r.country, phone: r.phone, email: r.email,
    }),
    packages: input.parcels.map(parcel => ({
      weight: Math.round(parcel.weightKg * 100) / 100,
      width: Math.ceil(parcel.widthCm), height: Math.ceil(parcel.heightCm), length: Math.ceil(parcel.lengthCm),
    })),
    content: input.content.slice(0, 60),
    contentvalue: Math.round(input.contentValue * 100) / 100,
    contentValue_currency: input.currency,
    content_second_hand: false,
    shipment_custom_reference: input.orderReference.slice(0, 50),
  };
}

/**
 * Maps the draft POST HTTP status. Only 429/503 are explicit "not processed"
 * answers (retryable); other 5xx may follow a created draft (ambiguous, never
 * retried automatically).
 */
export function classifyPacklinkDraftStatus(status: number): ShipmentDraftError['code'] {
  if (status === 401 || status === 403) return 'missing_configuration';
  if (status === 429 || status === 503) return 'provider_unavailable';
  if (status >= 400 && status < 500) return 'provider_rejected';
  return 'ambiguous_creation';
}

async function loadDefaultWarehouse(apiKey: string): Promise<PacklinkAddress> {
  let response: Response;
  try {
    response = await fetch(BASE + '/clients/warehouses', {
      headers: { Authorization: apiKey, Accept: 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8_000),
    });
  } catch { throw new ShipmentDraftError('provider_unavailable'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ShipmentDraftError(response.status === 401 || response.status === 403 ? 'missing_configuration' : 'provider_unavailable');
  }
  const warehouse = selectPacklinkWarehouse(await readBoundedJson(response));
  if (!warehouse) throw new ShipmentDraftError('missing_configuration');
  return warehouse;
}

export const packlinkAdapter: ShippingProviderAdapter = {
  key: 'packlink', displayName: 'Packlink',
  capabilities: { providerReference: true, trackingTimeline: true, trackingUrl: true, webhooks: false, createDraft: true },
  async createShipmentDraft(context, input) {
    const key = tenantApiKey(context);
    if (!key) throw new ShipmentDraftError('missing_configuration');
    // Read-only and before any POST: a failure here can never leave a draft behind.
    const from = await loadDefaultWarehouse(key);
    let response: Response;
    try {
      response = await fetch(BASE + '/shipments', {
        method: 'POST',
        headers: { Authorization: key, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPacklinkDraftPayload(from, input)),
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw new ShipmentDraftError(name === 'TimeoutError' || name === 'AbortError' ? 'provider_timeout' : 'ambiguous_creation');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ShipmentDraftError(classifyPacklinkDraftStatus(response.status));
    }
    const reference = text(object(await readBoundedJson(response)).reference, 60)?.toUpperCase() ?? null;
    if (!reference || !/^[A-Z0-9]{6,40}$/.test(reference)) throw new ShipmentDraftError('invalid_provider_response');
    return { provider: 'packlink', providerReference: reference, providerStatus: null, createdAt: new Date().toISOString() };
  },
  async resolveShipment(context, rawReference) {
    const reference = rawReference.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,40}$/.test(reference)) throw new ShippingProviderError('shipment_reference_invalid');
    const key = tenantApiKey(context);
    if (!key) throw new ShippingProviderError('shipping_provider_not_configured');
    const path = '/shipments/' + encodeURIComponent(reference);
    // A draft not yet purchased has no tracking: Packlink answers 404 on /track while
    // GET /shipments/{ref} is 200 (observed on IT2026PRO0006698079). Only the shipment
    // endpoint proves existence; a missing timeline is an empty one.
    const [shipment, timeline] = await Promise.all([
      request(key, path),
      request(key, path + '/track').catch((error: unknown) => {
        if (error instanceof ShippingProviderError && error.code === 'shipment_not_found') return [];
        throw error;
      }),
    ]);
    return parsePacklinkShipment(reference, shipment, timeline);
  },
};
