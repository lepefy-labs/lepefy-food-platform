import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { runCampaignBatch } from '@/lib/shipping/intelligence/runCampaignBatch';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const MANUAL_TICK_COOLDOWN_MS = 10_000;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data: campaign, error: campaignError } = await supabase
    .from('shipping_simulation_campaigns')
    .select('id, status')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (campaignError) {
    return NextResponse.json({ error: 'campaign_lookup_failed' }, { status: 500 });
  }
  if (!campaign) {
    return NextResponse.json({ error: 'campaign_not_found' }, { status: 404 });
  }
  if (campaign.status !== 'queued' && campaign.status !== 'running') {
    return NextResponse.json({ error: 'campaign_not_processable' }, { status: 409 });
  }

  // Evita che clic ripetuti trasformino il browser in un secondo cron.
  // Il cron interno non passa da questo cooldown e resta sempre il fallback.
  const { data: recentItems } = await supabase
    .from('shipping_simulation_campaign_items')
    .select('attempted_at')
    .eq('campaign_id', params.id)
    .eq('tenant_id', tenant.id)
    .not('attempted_at', 'is', null)
    .order('attempted_at', { ascending: false })
    .limit(1);

  const lastAttemptedAt = (recentItems?.[0] as { attempted_at: string | null } | undefined)?.attempted_at;
  if (lastAttemptedAt) {
    const elapsed = Date.now() - Date.parse(lastAttemptedAt);
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MANUAL_TICK_COOLDOWN_MS) {
      const retryAfterSeconds = Math.max(1, Math.ceil((MANUAL_TICK_COOLDOWN_MS - elapsed) / 1000));
      return NextResponse.json(
        { error: 'campaign_tick_cooldown', retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
      );
    }
  }

  const result = await runCampaignBatch(supabase, tenant, { campaignId: params.id });

  const { data: updatedCampaign } = await supabase
    .from('shipping_simulation_campaigns')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  return NextResponse.json({ success: true, result, campaign: updatedCampaign ?? campaign });
}
