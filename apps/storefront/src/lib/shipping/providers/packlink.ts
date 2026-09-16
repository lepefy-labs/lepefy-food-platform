import { ShippingProviderError, type NormalizedShipmentStatus, type ProviderShipmentSnapshot, type ShippingProviderAdapter } from './types';

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
  if (code === 'RETURNED') return 'returned';
  if (['EXCEPTION', 'INCIDENT', 'DELIVERY_FAILED'].includes(code)) return 'exception';
  if (['PENDING', 'DRAFT', 'PROCESSING'].includes(code)) return 'pending';
  return 'unknown';
}

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
  if (!['reference', 'shipment_reference', 'carrier_product_id', 'carrier_shipment_tracking_number', 'trackings', 'status'].some(key => key in shipment)
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
  const latest = events.at(-1);
  const providerStatus = latest?.providerStatus ?? text(shipment.status_code ?? shipment.status);
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

export const packlinkAdapter: ShippingProviderAdapter = {
  key: 'packlink', displayName: 'Packlink',
  capabilities: { providerReference: true, trackingTimeline: true, trackingUrl: true, webhooks: false },
  async resolveShipment(context, rawReference) {
    const reference = rawReference.trim().toUpperCase();
    if (!/^[A-Z0-9]{6,40}$/.test(reference)) throw new ShippingProviderError('shipment_reference_invalid');
    const key = text(context.tenant.packlink_api_key, 4096) || process.env.PACKLINK_API_KEY;
    if (!key) throw new ShippingProviderError('shipping_provider_not_configured');
    const path = '/shipments/' + encodeURIComponent(reference);
    const [shipment, timeline] = await Promise.all([request(key, path), request(key, path + '/track')]);
    return parsePacklinkShipment(reference, shipment, timeline);
  },
};
