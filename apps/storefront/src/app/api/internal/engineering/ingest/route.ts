import { NextResponse } from 'next/server';
import { IngestError, INGEST_LIMITS } from '@/lib/engineering/ingest/protocol';
import { handleIngest, ingestAuthorized } from '@/lib/engineering/server/ingest';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Index upload from GitHub Actions. Bearer ENGINEERING_INGEST_TOKEN only: the CI job never holds the
 * service-role key, no cookie or tenant participates, and a missing/short token disables the route.
 * POST { action: start | missing | blobs | rows | complete | fail, ... } (docs/engineering/INDEXING.md).
 */
export async function POST(request: Request) {
  const auth = ingestAuthorized(request.headers.get('authorization'));
  if (auth === 'disabled') return NextResponse.json({ error: 'Ingest disabled' }, { status: 503, headers: NO_STORE });
  if (auth === 'denied') return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { ...NO_STORE, 'WWW-Authenticate': 'Bearer' } });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > INGEST_LIMITS.maxBodyBytes) return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: NO_STORE });
  let text: string;
  try { text = await request.text(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE }); }
  if (Buffer.byteLength(text, 'utf8') > INGEST_LIMITS.maxBodyBytes) return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: NO_STORE });

  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE });

  try {
    return NextResponse.json(await handleIngest(body as Record<string, unknown>), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof IngestError) return NextResponse.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    console.error('[engineering/ingest] failed:', (error as { code?: string })?.code ?? 'unknown');
    return NextResponse.json({ error: 'internal_error' }, { status: 500, headers: NO_STORE });
  }
}
