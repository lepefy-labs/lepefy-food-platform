import type {
  ShippingIntegrationAdapter,
  ShippingIntegrationSnapshot,
  ShippingIntegrationState,
  ShippingProviderContext,
  ShippingTrackingEvent,
} from './types';

const PACKLINK_API_BASE = 'https://api.packlink.com/v1';
const REQUEST_TIMEOUT_MS = 12_000;
const REFERENCE_PATTERN = /^[A-Z0-9]{6,40}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

async function packlinkGet(apiKey: string, path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${PACKLINK_API_BASE}${path}`, {
      method: 'GET',
      headers: {
        Authorization: apiKey,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    const raw = await response.text();
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = raw;
      }
    }

    if (!response.ok) {
      const suffix = typeof body === 'string' ? `: ${body.slice(0, 180)}` : '';
      throw new Error(`Packlink HTTP ${response.status}${suffix}`);
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function parseEvents(value: unknown): ShippingTrackingEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ShippingTrackingEvent | null => {
      const row = asRecord(item);
      if (!row) return null;
      const timestamp = typeof row.timestamp === 'number' && Number.isFinite(row.timestamp)
        ? row.timestamp
        : null;
      const description = asString(row.description) ?? '';
      const statusCode = asString(row.status_code) ?? asString(row.statusCode) ?? '';
      if (!description && !statusCode) return null;
      return { timestamp, description, statusCode };
    })
    .filter((item): item is ShippingTrackingEvent => Boolean(item))
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

function normalizeState(events: ShippingTrackingEvent[]): ShippingIntegrationState {
  const codes = events.map(event => event.statusCode.toUpperCase());
  if (codes.some(code => code === 'DELIVERED' || code.includes('DELIVERED'))) return 'delivered';
  if (codes.some(code => code.includes('EXCEPTION') || code.includes('FAILED') || code.includes('RETURN'))) return 'exception';
  if (codes.some(code => code.includes('IN_TRANSIT') || code.includes('OUT_FOR_DELIVERY'))) return 'in_transit';
  if (codes.some(code => code.includes('READY') || code.includes('COLLECTION') || code.includes('PICKUP'))) return 'ready';
  return events.length > 0 ? 'pending' : 'unknown';
}

function carrierFromShipment(shipment: Record<string, unknown>): string | null {
  const direct = asString(shipment.carrier_name)
    ?? asString(shipment.carrierName)
    ?? asString(shipment.carrier);
  if (direct) return direct;

  const service = asRecord(shipment.service);
  const nested = service
    ? asString(service.carrier_name) ?? asString(service.carrierName) ?? asString(service.carrier)
    : null;
  if (nested) return nested;

  const productId = asString(shipment.carrier_product_id)?.toUpperCase();
  if (!productId) return null;
  const known = ['BRT', 'DHL', 'DPD', 'GLS', 'UPS', 'FEDEX', 'TNT', 'SDA'];
  return known.find(name => productId.split(/[_-]/).includes(name)) ?? null;
}

function resolveTrackingUrl(template: string | null, trackingCode: string | null): string | null {
  if (!template || !trackingCode) return template;
  const encoded = encodeURIComponent(trackingCode);
  return template
    .replace(/\[tracking\]/gi, encoded)
    .replace(/%5Btracking%5D/gi, encoded);
}

export const packlinkShippingAdapter: ShippingIntegrationAdapter = {
  key: 'packlink',

  async fetchShipment(reference, context: ShippingProviderContext): Promise<ShippingIntegrationSnapshot> {
    const normalizedReference = reference.trim().toUpperCase();
    if (!REFERENCE_PATTERN.test(normalizedReference)) {
      throw new Error('Référence Packlink invalide.');
    }

    const apiKey = context.packlinkApiKey ?? process.env.PACKLINK_API_KEY;
    if (!apiKey) throw new Error('Clé API Packlink non configurée.');

    const encodedReference = encodeURIComponent(normalizedReference);
    const [shipmentRaw, trackingRaw] = await Promise.all([
      packlinkGet(apiKey, `/shipments/${encodedReference}`),
      packlinkGet(apiKey, `/shipments/${encodedReference}/track`),
    ]);

    const shipment = asRecord(shipmentRaw);
    if (!shipment) throw new Error('Réponse Packlink expédition invalide.');

    const events = parseEvents(trackingRaw);
    const latest = events.at(-1) ?? null;
    const trackingCode = asString(shipment.carrier_shipment_tracking_number)
      ?? asStringArray(shipment.trackings)[0]
      ?? null;
    const trackingTemplate = asString(shipment.tracking_url);
    const labelUrls = asStringArray(shipment.labels);

    return {
      provider: 'packlink',
      reference: normalizedReference,
      state: normalizeState(events),
      providerStatus: latest?.statusCode || null,
      carrier: carrierFromShipment(shipment),
      trackingCode,
      trackingUrl: resolveTrackingUrl(trackingTemplate, trackingCode),
      estimatedDeliveryDate: asString(shipment.estimated_delivery_date),
      labelUrls,
      events,
      syncedAt: new Date().toISOString(),
      syncBlockedReason: null,
    };
  },
};
