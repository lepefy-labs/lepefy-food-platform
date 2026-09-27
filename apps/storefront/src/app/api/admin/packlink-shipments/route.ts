import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getTenant } from '@/lib/tenant/getTenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PACKLINK_SHIPMENTS_URL = 'https://api.packlink.com/v1/shipments';
const MAX_RESPONSE_BYTES = 512_000;
const PREVIEW_LIMIT = 25;
const SENSITIVE_FIELD = /^(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret)$/i;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Admin-only exploratory response: Packlink's official connector confirms GET by
// reference, but does not document an account-wide list endpoint.
function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[nested data omitted]';
  if (Array.isArray(value)) return value.slice(0, 50).map(item => redact(item, depth + 1));
  if (!record(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_FIELD.test(key))
    .slice(0, 80)
    .map(([key, item]) => [key, redact(item, depth + 1)]));
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
      if (bytes > MAX_RESPONSE_BYTES) {
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

const noStore = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  if (tenant.shipping_provider !== 'packlink') {
    return NextResponse.json(
      { available: false, reason: 'provider_not_packlink' },
      { status: 400, headers: noStore },
    );
  }

  // Do not fall back to the platform-wide key: this endpoint must inspect only
  // the Packlink account explicitly configured for the current tenant.
  const apiKey = tenant.packlink_api_key?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { available: false, reason: 'tenant_api_key_missing' },
      { status: 409, headers: noStore },
    );
  }

  let response: Response;
  try {
    response = await fetch(PACKLINK_SHIPMENTS_URL, {
      method: 'GET',
      headers: { Authorization: apiKey, Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return NextResponse.json(
      { available: false, reason: 'packlink_unavailable' },
      { status: 503, headers: noStore },
    );
  }

  // A 404/405 is evidence that account-wide enumeration is unavailable for
  // this key/path, not evidence that the tenant has zero shipments.
  if (!response.ok) {
    await response.body?.cancel();
    const unsupported = response.status === 404 || response.status === 405;
    return NextResponse.json(
      {
        available: false,
        reason: unsupported ? 'list_endpoint_not_available' : 'packlink_error',
        upstreamStatus: response.status,
        note: unsupported
          ? 'Packlink does not expose an account shipment list at this path for this key.'
          : 'Packlink did not return a usable shipment list.',
      },
      { status: unsupported ? 501 : 502, headers: noStore },
    );
  }

  let payload: unknown;
  try {
    payload = await readBoundedJson(response);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'response_too_large';
    return NextResponse.json(
      { available: false, reason: tooLarge ? 'response_too_large' : 'invalid_packlink_response' },
      { status: 502, headers: noStore },
    );
  }

  // No undocumented pagination or response schema assumptions: report an
  // unrecognized successful shape rather than presenting it as an empty list.
  const root = record(payload) ? payload : null;
  const array = Array.isArray(payload) ? payload
    : root && Array.isArray(root.shipments) ? root.shipments
    : root && Array.isArray(root.results) ? root.results
    : root && Array.isArray(root.data) ? root.data
    : null;

  if (!array) {
    return NextResponse.json(
      {
        available: false,
        reason: 'list_response_shape_unknown',
        upstreamStatus: response.status,
        responseKeys: root ? Object.keys(root).slice(0, 40) : [],
      },
      { status: 502, headers: noStore },
    );
  }

  const sample = array.slice(0, PREVIEW_LIMIT);
  return NextResponse.json(
    {
      available: true,
      source: 'packlink_account',
      queriedAt: new Date().toISOString(),
      upstreamStatus: response.status,
      returnedByPacklink: array.length,
      previewLimit: PREVIEW_LIMIT,
      truncated: array.length > PREVIEW_LIMIT,
      paginationVerified: false,
      responseKeys: root ? Object.keys(root).slice(0, 40) : [],
      shipmentFields: sample.find(record) ? Object.keys(sample.find(record) as JsonRecord).slice(0, 80) : [],
      shipments: sample.map(item => redact(item)),
    },
    { headers: noStore },
  );
}
