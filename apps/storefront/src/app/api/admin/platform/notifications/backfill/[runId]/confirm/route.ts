import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { confirmBackfill } from '@/lib/notifications/staff/backfill';
import { requireBackfillApi } from '@/lib/notifications/staff/backfillApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * « Envoyer les notifications » (platform owner): re-plans the previewed run,
 * refuses when anything changed, claims it once and queues the deliveries.
 */
export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const body = await req.json().catch(() => null) as { tenantId?: unknown } | null;
  const guard = await requireBackfillApi(body?.tenantId);
  if (!guard.ok) return guard.response;
  if (!UUID.test(params.runId)) return NextResponse.json({ error: 'Aperçu introuvable.' }, { status: 404 });
  try {
    const result = await confirmBackfill(createServiceClient(), { tenantId: guard.tenantId, runId: params.runId, actor: guard.actor });
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ queued: result.queued, retried: result.retried, attempted: result.attempted, accepted: result.accepted });
  } catch (error) {
    console.error('[backfill/confirm] failed —', (error as { code?: string } | null)?.code ?? (error instanceof Error ? error.message : 'unknown'));
    return NextResponse.json({ error: 'Envoi interrompu : consultez l’historique avant de relancer.' }, { status: 500 });
  }
}
