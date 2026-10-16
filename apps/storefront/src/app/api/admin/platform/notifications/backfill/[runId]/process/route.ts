import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { processRun } from '@/lib/notifications/staff/backfill';
import { requireBackfillApi } from '@/lib/notifications/staff/backfillApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sends the next queued messages of a confirmed run; `retryFailed` re-queues only its failed ones. */
export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const body = await req.json().catch(() => null) as { tenantId?: unknown; retryFailed?: unknown } | null;
  const guard = await requireBackfillApi(body?.tenantId);
  if (!guard.ok) return guard.response;
  if (!UUID.test(params.runId)) return NextResponse.json({ error: 'Rattrapage introuvable.' }, { status: 404 });
  const result = await processRun(createServiceClient(), guard.tenantId, params.runId, { retryFailed: body?.retryFailed === true });
  if (!result) return NextResponse.json({ error: 'Rattrapage introuvable ou en cours.' }, { status: 404 });
  return NextResponse.json(result);
}
