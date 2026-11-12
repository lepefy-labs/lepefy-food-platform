/**
 * POST /api/internal/studio-worker
 *
 * Tick n8n (every 5 minutes, dedicated bearer STUDIO_WORKER_TOKEN, never the
 * service-role key): resumes Studio jobs that are due — queued retries and
 * jobs whose function was interrupted (expired lock) — for every tenant.
 * `{ "cleanup": true }` (daily) also purges unused drafts' private files.
 */
import { NextRequest, NextResponse } from 'next/server';
import { schedulerBearerAuthorized } from '@/lib/shipping/shippingSyncAuth';
import { processStudioJobs } from '@/lib/studio/server/worker';
import { cleanupStudioDrafts } from '@/lib/studio/server/cleanup';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!schedulerBearerAuthorized(request.headers.get('authorization'), process.env.STUDIO_WORKER_TOKEN, undefined)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  const body = await request.json().catch(() => ({})) as { cleanup?: boolean };
  try {
    const jobs = await processStudioJobs({ limit: 3, deadlineMs: 110_000 });
    const cleanup = body.cleanup === true ? await cleanupStudioDrafts() : null;
    return NextResponse.json({ ok: true, processed: jobs.processed, results: jobs.results, cleanup }, { headers });
  } catch {
    console.error('[studio-worker] tick unavailable');
    return NextResponse.json({ error: 'studio_worker_unavailable' }, { status: 503, headers });
  }
}
