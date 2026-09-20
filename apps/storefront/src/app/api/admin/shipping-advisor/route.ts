/**
 * POST /api/admin/shipping-advisor
 * Body: { weightKg: number; country: string; postalCode: string }
 *
 * Assistant expédition : pour chaque profil d'emballage actif, estime le
 * coût attendu à partir des observations historiques (aucun appel Packlink
 * ici — décision support, jamais un devis live). Voir similarity.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { estimateForProfile } from '@/lib/shipping/intelligence/similarity';
import { resolveZoneCode } from '@/lib/shipping/intelligence/resolveZone';
import { INTELLIGENCE_FROM_ADDRESS } from '@/lib/shipping/intelligence/quoteScenario';
import { splitIntoParcels } from '@/lib/shipping/calculateShipping';
import type { ShippingPackagingProfileRow } from '@lepefy/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as { weightKg?: unknown; country?: unknown; postalCode?: unknown };
  const weightKg = Number(body.weightKg);
  const country = typeof body.country === 'string' ? body.country.trim().toUpperCase() : '';
  const postalCode = typeof body.postalCode === 'string' ? body.postalCode.trim() : '';

  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    return NextResponse.json({ error: 'Poids invalide.' }, { status: 400 });
  }
  if (!/^[A-Z]{2}$/.test(country) || !postalCode) {
    return NextResponse.json({ error: 'Destination invalide.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: profileRows } = await supabase
    .from('shipping_packaging_profiles')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('active', true);
  const profiles = (profileRows as ShippingPackagingProfileRow[] | null) ?? [];

  if (profiles.length === 0) {
    return NextResponse.json({ error: 'Aucun profil d\'emballage actif — configurez-en un dans « Emballages ».' }, { status: 400 });
  }

  const zoneCode = await resolveZoneCode(supabase, tenant.id, country, postalCode);
  const totalWeightG = Math.round(weightKg * 1000);

  // Découpage en colis réel (même formule que le flux de calcul de
  // livraison) affiché à l'écran, pour que le prix indiqué ne soit jamais
  // ambigu sur le nombre/poids des colis effectivement quotés.
  const packagingByProfileId = new Map(
    profiles.map((profile) => {
      const parcelWeightsG = splitIntoParcels(totalWeightG, profile.max_weight_g / 1000);
      return [profile.id, {
        boxDimensions: { length: profile.box_length_cm, width: profile.box_width_cm, height: profile.box_height_cm },
        parcelWeightsG,
      }] as const;
    }),
  );

  const estimations = await Promise.all(
    profiles.map((profile) => {
      const numParcels = Math.max(1, Math.ceil(totalWeightG / profile.max_weight_g));
      return estimateForProfile(supabase, {
        tenantId: tenant.id,
        provider: 'packlink',
        originCountry: INTELLIGENCE_FROM_ADDRESS.country,
        originPostalCode: INTELLIGENCE_FROM_ADDRESS.zip_code,
        destinationCountry: country,
        destinationZoneCode: zoneCode,
        numParcels,
        totalWeightG,
        profile,
      });
    }),
  );

  // Le classement/recommandation se base sur le transporteur le moins cher
  // de chaque profil (byCarrier[0]), pas sur la plage agrégée tous
  // transporteurs confondus — sinon un profil avec un seul transporteur
  // cher paraîtrait équivalent à un profil qui a aussi une option bon
  // marché noyée dans la plage.
  const bestCarrierCost = (e: (typeof estimations)[number]) => e.byCarrier[0]?.medianCost ?? null;

  const withSufficientData = estimations.filter((e) => bestCarrierCost(e) != null);
  const cheapest = withSufficientData.length > 0
    ? withSufficientData.reduce((min, e) => (bestCarrierCost(e)! < bestCarrierCost(min)! ? e : min))
    : null;

  const ranked = [...estimations].sort((a, b) => {
    const costA = bestCarrierCost(a);
    const costB = bestCarrierCost(b);
    if (costA == null) return 1;
    if (costB == null) return -1;
    return costA - costB;
  });

  const cheapestCost = cheapest ? bestCarrierCost(cheapest) : null;

  return NextResponse.json({
    input: { weightKg, country, postalCode, zoneCode },
    recommendations: ranked.map((e) => ({
      ...e,
      ...packagingByProfileId.get(e.packagingProfileId),
      recommended: cheapest !== null && e.packagingProfileId === cheapest.packagingProfileId,
      costDeltaVsRecommended: cheapestCost != null && bestCarrierCost(e) != null
        ? parseFloat((bestCarrierCost(e)! - cheapestCost).toFixed(2))
        : null,
    })),
  });
}
