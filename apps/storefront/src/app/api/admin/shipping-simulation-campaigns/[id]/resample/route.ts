import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import { loadCampaignCoverage } from '@/lib/shipping/intelligence/campaignData';
import { needsResample } from '@/lib/shipping/intelligence/campaignCoverage';
import { MAX_CAMPAIGN_SCENARIOS } from '@/lib/shipping/intelligence/scenarioMatrix';
import { normalizePostalCode } from '@/lib/shipping/intelligence/requestIdentity';
import type { ShippingCampaignItemScenario, ShippingScenarioMatrix, ShippingSimulationCampaignRow } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

/**
 * POST /api/admin/shipping-simulation-campaigns/:id/resample
 *
 * Crée — sur action explicite de l'admin, jamais automatiquement — une
 * campagne de remesure limitée aux scénarios de la campagne source qui n'ont
 * pas de devis valide (échecs + données historiques incompatibles). Les
 * données historiques ne sont ni supprimées ni réécrites. Le worker
 * réemploiera un devis strictement identique encore frais plutôt que de
 * rappeler Packlink.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as { confirm?: unknown };
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'Confirmation explicite requise.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: campaignData } = await supabase
    .from('shipping_simulation_campaigns')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!campaignData) return NextResponse.json({ error: 'Campagne introuvable.' }, { status: 404 });
  const campaign = campaignData as ShippingSimulationCampaignRow;

  const { count: activeResamples } = await supabase
    .from('shipping_simulation_campaigns')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .in('status', ['queued', 'running'])
    .eq('scenario_matrix->>sourceCampaignId', campaign.id);
  if ((activeResamples ?? 0) > 0) {
    return NextResponse.json({ error: 'Une remesure de cette campagne est déjà en cours.' }, { status: 409 });
  }

  let coverage;
  try {
    coverage = await loadCampaignCoverage(supabase, tenant.id, campaign);
  } catch {
    return NextResponse.json({ error: 'Impossible de calculer la couverture de la campagne.' }, { status: 500 });
  }

  const { data: profileRows } = await supabase.from('shipping_packaging_profiles').select('id').eq('tenant_id', tenant.id);
  const existingProfiles = new Set(((profileRows ?? []) as { id: string }[]).map((p) => p.id));

  const unique = new Map<string, ShippingCampaignItemScenario>();
  let profileMissing = 0;
  for (const item of coverage.items) {
    const classification = coverage.classifications.get(item.id);
    if (!classification || !needsResample(classification.cls)) continue;
    const scenario = item.scenario;
    if (!existingProfiles.has(scenario.packagingProfileId)) { profileMissing++; continue; }
    const postalCode = normalizePostalCode(scenario.destination.postalCode);
    const key = `${scenario.destination.country}|${postalCode}|${scenario.packagingProfileId}|${scenario.weightKg}`;
    if (!unique.has(key)) {
      unique.set(key, { ...scenario, destination: { ...scenario.destination, postalCode } });
    }
  }

  const sorted = Array.from(unique.entries()).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  if (sorted.length === 0) {
    return NextResponse.json({ error: 'Aucun scénario à remesurer.', profileMissing }, { status: 400 });
  }
  const selected = sorted.slice(0, MAX_CAMPAIGN_SCENARIOS).map(([, s]) => s);
  const deferred = sorted.length - selected.length;

  const sourceMatrix = campaign.scenario_matrix as ShippingScenarioMatrix;
  const usedPostal = new Set(selected.map((s) => `${s.destination.country}|${s.destination.postalCode}`));
  const matrix: ShippingScenarioMatrix = {
    weightsKg: Array.from(new Set(selected.map((s) => s.weightKg))).sort((a, b) => a - b),
    packagingProfileIds: Array.from(new Set(selected.map((s) => s.packagingProfileId))),
    destinations: (sourceMatrix.destinations ?? []).filter((d) => usedPostal.has(`${d.country}|${normalizePostalCode(d.postalCode)}`)),
    freshnessWindowDays: sourceMatrix.freshnessWindowDays ?? 30,
    samplingMode: 'resample',
    sourceCampaignId: campaign.id,
  };

  const { data: created, error: createError } = await supabase
    .from('shipping_simulation_campaigns')
    .insert({
      tenant_id: tenant.id,
      name: `Remesure — ${campaign.name}`.slice(0, 200),
      status: 'queued',
      scenario_matrix: matrix,
      total_scenarios: selected.length,
      created_by: await getAdminId(),
    })
    .select('*')
    .single();
  if (createError || !created) {
    return NextResponse.json({ error: createError?.message ?? 'Erreur de création.' }, { status: 500 });
  }

  const newId = (created as { id: string }).id;
  const { error: itemsError } = await supabase.from('shipping_simulation_campaign_items').insert(
    selected.map((scenario) => ({ campaign_id: newId, tenant_id: tenant.id, scenario, status: 'pending' as const })),
  );
  if (itemsError) {
    await supabase.from('shipping_simulation_campaigns').delete().eq('id', newId).eq('tenant_id', tenant.id);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  return NextResponse.json({ campaign: created, scenarios: selected.length, deferred, profileMissing }, { status: 201 });
}
