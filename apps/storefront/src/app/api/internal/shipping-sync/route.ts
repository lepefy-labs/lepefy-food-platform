/**
 * POST /api/internal/shipping-sync
 *
 * Tick programmé par n8n (credential bearer dédié SHIPPING_SYNC_SCHEDULER_TOKEN),
 * avec compatibilité temporaire GitHub Actions (service-role bearer).
 * Synchronise un lot borné d'expéditions managed actives, puis traite la file
 * des brouillons d'expédition (migration 151) dans le temps restant.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { runShippingSyncBatch } from '@/lib/shipping/shippingSyncBatch';
import { runShipmentDraftBatch, defaultShipmentDraftDependencies } from '@/lib/shipping/shipmentDraft/shipmentDraftService';
import { shippingSyncSchedulerAuthorized } from '@/lib/shipping/shippingSyncAuth';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!shippingSyncSchedulerAuthorized(request.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const startedAt = Date.now();
  try {
    // Journal d'activité: changes written by this tick are attributed to the sync job.
    // Every database request is bounded: a stalled backend ends the tick cleanly (n8n waits 55 s, Vercel kills at 60 s).
    const service = createServiceClient({ auditActor: { actorType: 'automation', ref: 'shipping-sync', source: 'worker' }, requestTimeoutMs: 10_000 });
    // No new order after 30 s: the response always leaves the scheduler's 55 s window.
    const result = await runShippingSyncBatch(service, undefined, { startBefore: startedAt + 30_000 });
    // Isolated: a draft failure never fails the tracking sync tick. Start before 35 s, end by ~55 s.
    // Own client without request timeout: a draft write after the provider call must never be cut half-way.
    const draftService = createServiceClient({ auditActor: { actorType: 'automation', ref: 'shipping-sync', source: 'worker' } });
    const drafts = await runShipmentDraftBatch(draftService, defaultShipmentDraftDependencies, { limit: 3, startBefore: startedAt + 35_000 })
      .catch(() => { console.error('[shipping/draft] failed — code: batch_unavailable'); return null; });
    return NextResponse.json({ ok: true, ...result, drafts }, { headers });
  } catch {
    console.error('[shipping-sync] batch unavailable');
    return NextResponse.json({ error: 'shipping_sync_unavailable' }, { status: 503, headers });
  }
}
