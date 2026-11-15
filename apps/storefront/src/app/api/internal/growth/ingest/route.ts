import { NextResponse } from 'next/server';
import { GROWTH_INGEST_LIMITS, GrowthIngestError, growthIngestAuthorized, handleGrowthIngest } from '@/lib/growth/server/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Dossier upload from the growth CLI (`node growth/cli.mjs push`). Bearer
 * GROWTH_INGEST_TOKEN only: the CLI never holds the service-role key, and a
 * missing/short token disables the route. Every dossier is re-validated by the
 * growth engine; sales fields are never written here. docs/GROWTH_PROSPECTING.md
 */
export async function POST(request: Request) {
  const auth = growthIngestAuthorized(request.headers.get('authorization'));
  if (auth === 'disabled') return NextResponse.json({ error: 'Ingest disabled' }, { status: 503, headers: NO_STORE });
  if (auth === 'denied') return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { ...NO_STORE, 'WWW-Authenticate': 'Bearer' } });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > GROWTH_INGEST_LIMITS.maxBodyBytes) return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: NO_STORE });
  let text: string;
  try { text = await request.text(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE }); }
  if (Buffer.byteLength(text, 'utf8') > GROWTH_INGEST_LIMITS.maxBodyBytes) return NextResponse.json({ error: 'Payload too large' }, { status: 413, headers: NO_STORE });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE }); }

  try {
    return NextResponse.json(await handleGrowthIngest(body), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof GrowthIngestError) return NextResponse.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    console.error('[growth/ingest] failed');
    return NextResponse.json({ error: 'internal_error' }, { status: 500, headers: NO_STORE });
  }
}
