import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import { buildCampaignScenarios, validateScenarioMatrix } from '@/lib/shipping/intelligence/scenarioMatrix';
import type { ShippingScenarioMatrix } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('shipping_simulation_campaigns')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const adminId = await getAdminId();
  const body = await req.json() as Record<string, unknown>;

  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : `Campagne ${new Date().toLocaleDateString('fr-FR')}`;

  const matrix: ShippingScenarioMatrix = {
    weightsKg: Array.isArray(body.weightsKg) ? body.weightsKg.map(Number) : [],
    packagingProfileIds: Array.isArray(body.packagingProfileIds) ? body.packagingProfileIds.map(String) : [],
    destinations: Array.isArray(body.destinations) ? body.destinations as ShippingScenarioMatrix['destinations'] : [],
    freshnessWindowDays: Number.isFinite(Number(body.freshnessWindowDays)) ? Number(body.freshnessWindowDays) : 30,
  };

  const validationError = validateScenarioMatrix(matrix);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const scenarios = buildCampaignScenarios(matrix);

  const supabase = createServiceClient();

  const { data: campaign, error: campaignError } = await supabase
    .from('shipping_simulation_campaigns')
    .insert({
      tenant_id: tenant.id,
      name,
      status: 'queued',
      scenario_matrix: matrix,
      total_scenarios: scenarios.length,
      created_by: adminId,
    })
    .select('*')
    .single();

  if (campaignError || !campaign) {
    return NextResponse.json({ error: campaignError?.message ?? 'Erreur de création.' }, { status: 500 });
  }

  const itemRows = scenarios.map((scenario) => ({
    campaign_id: (campaign as { id: string }).id,
    tenant_id: tenant.id,
    scenario,
    status: 'pending' as const,
  }));

  const { error: itemsError } = await supabase.from('shipping_simulation_campaign_items').insert(itemRows);
  if (itemsError) {
    await supabase.from('shipping_simulation_campaigns').delete().eq('id', (campaign as { id: string }).id);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  return NextResponse.json(campaign, { status: 201 });
}
