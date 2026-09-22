import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import { buildCampaignScenarios, validateScenarioMatrix } from '@/lib/shipping/intelligence/scenarioMatrix';
import { resolveZoneCodeFromRows } from '@/lib/shipping/intelligence/resolveZone';
import { normalizePostalCode } from '@/lib/shipping/intelligence/requestIdentity';
import { buildWeightsByProfile } from '@/lib/shipping/intelligence/weightPresets';
import type { ShippingPackagingProfileRow, ShippingSamplingMode, ShippingScenarioMatrix, ShippingZoneRow } from '@lepefy/types';

function optionalText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function optionalAdminCode(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9-]{1,20}$/.test(code) ? code : undefined;
}

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
    // Chaîne normalisée, jamais convertie en nombre : les zéros initiaux comptent.
    const postalCode = typeof raw.postalCode === 'string' ? normalizePostalCode(raw.postalCode) : '';
    const requestedZoneCode = typeof raw.zoneCode === 'string' && raw.zoneCode.trim() ? raw.zoneCode.trim() : null;
    const label = optionalText(raw.label, 120);
    const city = optionalText(raw.city, 120);
    const adminCode1 = optionalAdminCode(raw.adminCode1);
    const adminCode2 = optionalAdminCode(raw.adminCode2);
    const adminName = optionalText(raw.adminName, 120);

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
    // Un même CAP peut desservir plusieurs communes : un seul scénario par CAP
    // (le devis provider dépend du CAP), contexte de la première sélection conservé.
    if (!deduped.has(key)) {
      deduped.set(key, {
        country, postalCode, zoneCode, label,
        ...(city ? { city } : {}),
        ...(adminCode1 !== undefined ? { adminCode1 } : {}),
        ...(adminCode2 !== undefined ? { adminCode2 } : {}),
        ...(adminName ? { adminName } : {}),
      });
    }
  }

  const packagingProfileIds = Array.isArray(body.packagingProfileIds)
    ? Array.from(new Set(body.packagingProfileIds.map(String)))
    : [];
  const samplingMode: ShippingSamplingMode = body.samplingMode === 'initial' || body.samplingMode === 'deep'
    ? body.samplingMode
    : 'manual';

  let weightsByProfileId: Record<string, number[]> | undefined;
  let weightsKg: number[] = Array.isArray(body.weightsKg) ? body.weightsKg.map(Number) : [];

  if (samplingMode !== 'manual') {
    if (samplingMode === 'deep' && body.confirmDeepAnalysis !== true) {
      return NextResponse.json({ error: 'L’analyse approfondie doit être confirmée explicitement (volume d’appels Packlink élevé).' }, { status: 400 });
    }
    // Préréglage calculé côté serveur à partir des profils du tenant — le
    // client n'envoie que le mode, jamais une matrice « préréglée » arbitraire.
    const { data: profileData } = packagingProfileIds.length > 0
      ? await supabase
        .from('shipping_packaging_profiles')
        .select('id, max_weight_g')
        .eq('tenant_id', tenant.id)
        .in('id', packagingProfileIds)
      : { data: [] };
    const profiles = (profileData ?? []) as Pick<ShippingPackagingProfileRow, 'id' | 'max_weight_g'>[];
    if (profiles.length !== packagingProfileIds.length) {
      return NextResponse.json({ error: 'Profil d’emballage invalide.' }, { status: 400 });
    }
    weightsByProfileId = buildWeightsByProfile(samplingMode, profiles);
    weightsKg = Array.from(new Set(Object.values(weightsByProfileId).flat())).sort((a, b) => a - b);
  }

  const part = body.part && typeof body.part === 'object'
    ? body.part as { index?: unknown; count?: unknown }
    : null;

  const matrix: ShippingScenarioMatrix = {
    weightsKg,
    ...(weightsByProfileId ? { weightsByProfileId } : {}),
    packagingProfileIds,
    destinations: Array.from(deduped.values()),
    freshnessWindowDays: Number.isFinite(Number(body.freshnessWindowDays)) ? Number(body.freshnessWindowDays) : 30,
    samplingMode,
    ...(part && Number.isInteger(part.index) && Number.isInteger(part.count)
      ? { part: { index: part.index as number, count: part.count as number } }
      : {}),
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
