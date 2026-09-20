import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { ShippingQuoteObservationRow, ShippingSimulationCampaignItemRow } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data: campaign, error } = await supabase
    .from('shipping_simulation_campaigns')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .single();

  if (error || !campaign) return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });

  // Une campagne compte au plus MAX_CAMPAIGN_SCENARIOS (2000) items — la
  // limite explicite doit couvrir ce plafond, sinon PostgREST tronque
  // silencieusement à 1000 lignes.
  const { data: items } = await supabase
    .from('shipping_simulation_campaign_items')
    .select('*')
    .eq('campaign_id', params.id)
    .limit(2500);

  const observationIds = (items as ShippingSimulationCampaignItemRow[] | null ?? [])
    .map((i) => i.observation_id)
    .filter((id): id is string => Boolean(id));

  let observations: ShippingQuoteObservationRow[] = [];
  if (observationIds.length > 0) {
    const { data } = await supabase
      .from('shipping_quote_observations')
      .select('*')
      .in('id', observationIds)
      .limit(2500);
    observations = (data as ShippingQuoteObservationRow[] | null) ?? [];
  }

  return NextResponse.json({ campaign, items: items ?? [], observations });
}
