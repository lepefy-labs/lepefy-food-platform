/**
 * POST /api/internal/shipping-sync
 *
 * Tick programmé par n8n (credential bearer dédié SHIPPING_SYNC_SCHEDULER_TOKEN),
 * avec compatibilité temporaire GitHub Actions (service-role bearer).
 * Synchronise un lot borné d'expéditions managed actives.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { runShippingSyncBatch } from '@/lib/shipping/shippingSyncBatch';
import { shippingSyncSchedulerAuthorized } from '@/lib/shipping/shippingSyncAuth';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!shippingSyncSchedulerAuthorized(request.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  try {
    const result = await runShippingSyncBatch(createServiceClient());
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch {
    console.error('[shipping-sync] batch unavailable');
    return NextResponse.json({ error: 'shipping_sync_unavailable' }, { status: 503, headers });
  }
}
