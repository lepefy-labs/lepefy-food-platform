import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { loadCampaignCoverage } from '@/lib/shipping/intelligence/campaignData';
import type { ShippingSimulationCampaignRow } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

/**
 * Détail d'une campagne : couverture vérifiée par CAP × profil (items
 * paginés, observations relues par lots et filtrées par tenant). Ne renvoie
 * pas les milliers d'offres brutes.
 */
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

  try {
    const coverage = await loadCampaignCoverage(supabase, tenant.id, campaign as ShippingSimulationCampaignRow);
    return NextResponse.json({
      campaign,
      summary: coverage.summary,
      postalCodes: coverage.postalCodes,
      rows: coverage.rows,
      itemsTruncated: coverage.itemsTruncated,
    });
  } catch {
    return NextResponse.json({ error: 'Impossible de calculer la couverture de la campagne.' }, { status: 500 });
  }
}
