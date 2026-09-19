/**
 * POST /api/internal/shipping-campaign-worker
 *
 * Tick cron (voir .github/workflows/shipping-campaign-worker.yml), même
 * modèle d'authentification et de forme de réponse que
 * /api/internal/shipping-sync : Bearer SUPABASE_SERVICE_ROLE_KEY, comparaison
 * à temps constant, échec fermé. Traite un lot borné d'éléments de campagne
 * "pending" — jamais un long appel HTTP synchrone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { shippingSyncAuthorized } from '@/lib/shipping/shippingSyncAuth';
import { runCampaignBatch } from '@/lib/shipping/intelligence/runCampaignBatch';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!shippingSyncAuthorized(req.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';

  try {
    const tenant = await getTenant(slug);
    const supabase = createServiceClient();
    const result = await runCampaignBatch(supabase, tenant);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[shipping-campaign-worker] batch failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: 'batch_failed' }, { status: 500 });
  }
}
