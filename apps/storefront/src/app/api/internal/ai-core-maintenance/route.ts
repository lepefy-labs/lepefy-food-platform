import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { runAiCoreMaintenance } from '@/lib/ai/core/maintenance';
import { purgeExpiredNalaResponseMemory } from '@/lib/ai/nalaResponseMemory';

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
  const headers = { 'Cache-Control': 'no-store' };
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  try {
    const service = createServiceClient();
    const result = await runAiCoreMaintenance(
      () => service.rpc('purge_expired_ai_context'),
    );
    let deletedResponseMemory = 0;
    try {
      deletedResponseMemory = await purgeExpiredNalaResponseMemory(service);
    } catch {
      // Response Memory retention is auxiliary and must never break canonical AI Core retention.
      console.error('[lepefy-ai-core] Response memory retention failed');
    }
    return NextResponse.json({ ok: true, ...result, deletedResponseMemory }, { headers });
  } catch {
    console.error('[lepefy-ai-core] Retention maintenance failed');
    return NextResponse.json({ error: 'ai_core_maintenance_failed' }, { status: 503, headers });
  }
}
