/**
 * POST /api/internal/shipping-campaign-worker
 *
 * Tick programmé pour n8n (credential bearer dédié), avec compatibilité
 * temporaire GitHub Actions (service-role bearer). Comparaison à temps
 * constant, aucun secret dans l'URL ni les logs. Exécute un lot borné
 * d'éléments pending, sans acheter de transport ni modifier le checkout.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { shippingCampaignSchedulerAuthorized } from '@/lib/shipping/intelligence/schedulerAuth';
import { runCampaignBatch } from '@/lib/shipping/intelligence/runCampaignBatch';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!shippingCampaignSchedulerAuthorized(req.headers.get('authorization'))) {
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
