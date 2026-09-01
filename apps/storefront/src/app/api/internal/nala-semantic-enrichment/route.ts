import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { processNalaSemanticEnrichmentBatch } from '@/lib/ai/nalaSemanticEnrichment';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!expected || !supplied) return false;

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { batchSize?: unknown } | null;
  const requestedBatchSize = typeof body?.batchSize === 'number' ? body.batchSize : 20;

  try {
    const summary = await processNalaSemanticEnrichmentBatch(requestedBatchSize);
    return NextResponse.json({ ok: true, ...summary });
  } catch {
    console.error('[nala-semantic-enrichment] batch claim failed');
    return NextResponse.json({ error: 'Enrichment batch failed' }, { status: 500 });
  }
}
