import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import { buildCampaignScenarios, validateScenarioMatrix } from '@/lib/shipping/intelligence/scenarioMatrix';
import { resolveZoneCodeFromRows } from '@/lib/shipping/intelligence/resolveZone';
import type { ShippingScenarioMatrix, ShippingZoneRow } from '@lepefy/types';

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
  const supabase = createServiceClient();
  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim()
    : `Campagne ${new Date().toLocaleDateString('fr-FR')}`;

  const rawDestinations = Array.isArray(body.destinations)
    ? body.destinations as Array<Record<string, unknown>>
    : [];

  const { data: zoneData, error: zoneError } = await supabase
    .from('shipping_zones')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('active', true);

  if (zoneError) return NextResponse.json({ error: 'Impossible de résoudre les zones logistiques.' }, { status: 500 });

  const zones = (zoneData ?? []) as ShippingZoneRow[];
  const zonesByCode = new Map(zones.map((zone) => [zone.code, zone]));
  const deduped = new Map<string, ShippingScenarioMatrix['destinations'][number]>();

  for (const raw of rawDestinations) {
    const country = typeof raw.country === 'string' ? raw.country.trim().toUpperCase() : '';
    const postalCode = typeof raw.postalCode === 'string' ? raw.postalCode.trim().toUpperCase() : '';
    const requestedZoneCode = typeof raw.zoneCode === 'string' && raw.zoneCode.trim() ? raw.zoneCode.trim() : null;
    const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 120) : undefined;

    if (!/^[A-Z]{2}$/.test(country) || postalCode.length < 3 || postalCode.length > 12) {
      return NextResponse.json({ error: 'Une destination est invalide.' }, { status: 400 });
    }

    if (requestedZoneCode) {
      const requestedZone = zonesByCode.get(requestedZoneCode);
      if (!requestedZone || requestedZone.country !== country) {
        return NextResponse.json({ error: 'Zone logistique invalide pour cette destination.' }, { status: 400 });
      }
    }

    const zoneCode = requestedZoneCode ?? resolveZoneCodeFromRows(zones, country, postalCode);
    const key = `${country}|${postalCode}`;
    if (!deduped.has(key)) deduped.set(key, { country, postalCode, zoneCode, label });
  }

  const matrix: ShippingScenarioMatrix = {
    weightsKg: Array.isArray(body.weightsKg) ? body.weightsKg.map(Number) : [],
    packagingProfileIds: Array.isArray(body.packagingProfileIds) ? body.packagingProfileIds.map(String) : [],
    destinations: Array.from(deduped.values()),
    freshnessWindowDays: Number.isFinite(Number(body.freshnessWindowDays)) ? Number(body.freshnessWindowDays) : 30,
  };

  const validationError = validateScenarioMatrix(matrix);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const scenarios = buildCampaignScenarios(matrix);

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
