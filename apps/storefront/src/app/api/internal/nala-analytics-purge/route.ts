import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Daily scheduler entry point (n8n, ops/n8n/nala-analytics-purge.json):
 * enforces the 90-day retention of Nala conversations promised in the admin
 * (migration 095). purge_expired_nala_analytics() deletes sessions older than
 * 90 days for every tenant; interactions cascade, conversion events keep
 * their anonymous totals (session/interaction references become null).
 * Idempotent: a second run the same day deletes nothing.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.NALA_ANALYTICS_PURGE_CRON_SECRET ?? '';
  const provided = request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? '';
  if (!secret || !provided || Buffer.byteLength(secret) !== Buffer.byteLength(provided)
    || !timingSafeEqual(Buffer.from(secret), Buffer.from(provided))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await createServiceClient().rpc('purge_expired_nala_analytics');
  if (error) {
    console.error('[nala-analytics-purge] purge failed', error.message);
    return NextResponse.json({ ok: false, error: 'purge_failed' }, { status: 500 });
  }

  const deletedSessions = Number(data ?? 0);
  console.info('[nala-analytics-purge] done', { deletedSessions });
  return NextResponse.json({ ok: true, deletedSessions });
}
