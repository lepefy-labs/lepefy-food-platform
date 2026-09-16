import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PACKLINK_API_BASE = 'https://api.packlink.com/v1';
const REFERENCE_PATTERN = /^[A-Z0-9]{6,40}$/;
const MAX_TEXT_CHARS = 200_000;
const REQUEST_TIMEOUT_MS = 12_000;

interface ProbeResult {
  endpoint: string;
  ok: boolean;
  status: number | null;
  statusText: string | null;
  contentType: string | null;
  durationMs: number;
  data: unknown;
  error?: string;
  truncated?: boolean;
}

async function probePacklink(apiKey: string, endpoint: string): Promise<ProbeResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${PACKLINK_API_BASE}${endpoint}`, {
      method: 'GET',
      headers: {
        Authorization: apiKey,
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.1',
      },
      cache: 'no-store',
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    const location = response.headers.get('location');
    const isJson = contentType?.includes('json') ?? false;
    const isText = contentType?.startsWith('text/') ?? false;

    let data: unknown = null;
    let truncated = false;

    if (response.status !== 204) {
      if (isJson || isText || contentType === null) {
        const raw = await response.text();
        truncated = raw.length > MAX_TEXT_CHARS;
        const visibleRaw = truncated ? raw.slice(0, MAX_TEXT_CHARS) : raw;

        if (isJson && !truncated) {
          try {
            data = JSON.parse(visibleRaw) as unknown;
          } catch {
            data = visibleRaw;
          }
        } else {
          data = visibleRaw;
        }
      } else {
        await response.body?.cancel();
        data = {
          binaryResponse: true,
          contentType,
          contentLength,
          location,
          note: 'Corps binaire non téléchargé par le diagnostic.',
        };
      }
    }

    return {
      endpoint,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText || null,
      contentType,
      durationMs: Date.now() - startedAt,
      data,
      ...(truncated ? { truncated: true } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur réseau inconnue.';
    return {
      endpoint,
      ok: false,
      status: null,
      statusText: null,
      contentType: null,
      durationMs: Date.now() - startedAt,
      data: null,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  let body: { reference?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { available: false, message: 'Corps de requête invalide.' },
      { status: 400 },
    );
  }

  const reference =
    typeof body.reference === 'string' ? body.reference.trim().toUpperCase() : '';

  if (!REFERENCE_PATTERN.test(reference)) {
    return NextResponse.json(
      {
        available: false,
        message: 'Référence Packlink invalide. Utilisez uniquement lettres et chiffres.',
      },
      { status: 400 },
    );
  }

  if (tenant.shipping_provider !== 'packlink') {
    return NextResponse.json(
      {
        available: false,
        message: `Ce tenant utilise le provider "${tenant.shipping_provider}" : le diagnostic Packlink ne s'applique pas.`,
      },
      { status: 400 },
    );
  }

  const packlinkApiKey = tenant.packlink_api_key ?? process.env.PACKLINK_API_KEY;
  if (!packlinkApiKey) {
    return NextResponse.json(
      { available: false, message: 'Clé API Packlink non configurée.' },
      { status: 500 },
    );
  }

  const encodedReference = encodeURIComponent(reference);
  const endpoints = {
    shipment: `/shipments/${encodedReference}`,
    tracking: `/shipments/${encodedReference}/track`,
    labels: `/shipments/${encodedReference}/labels`,
  } as const;

  const [shipment, tracking, labels] = await Promise.all([
    probePacklink(packlinkApiKey, endpoints.shipment),
    probePacklink(packlinkApiKey, endpoints.tracking),
    probePacklink(packlinkApiKey, endpoints.labels),
  ]);

  console.info(
    '[admin/packlink-inspector] reference:',
    reference,
    '— statuses:',
    shipment.status,
    tracking.status,
    labels.status,
  );

  return NextResponse.json(
    {
      available: true,
      reference,
      queriedAt: new Date().toISOString(),
      probes: { shipment, tracking, labels },
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
