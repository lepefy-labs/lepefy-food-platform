import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { benchmarkNalaSemanticModels } from '@/lib/ai/nalaSemanticBenchmark';
import { getTenant } from '@/lib/tenant/getTenant';

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
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    modelKeys?: unknown;
    sampleSize?: unknown;
  } | null;
  const modelKeys = Array.isArray(body?.modelKeys)
    ? body.modelKeys.filter((value): value is string => typeof value === 'string')
    : [];
  const sampleSize = typeof body?.sampleSize === 'number' ? body.sampleSize : 8;

  try {
    const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(slug);
    const report = await benchmarkNalaSemanticModels({ tenantId: tenant.id, modelKeys, sampleSize });
    return NextResponse.json({ ok: true, ...report });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'benchmark_failed';
    console.error('[ai-provider-benchmark] failed', { errorCode: code });
    return NextResponse.json({ error: code }, { status: 500 });
  }
}
