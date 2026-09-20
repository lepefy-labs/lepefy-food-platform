import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingPackagingProfileRow, ShippingQuoteObservationRow } from '@lepefy/types';

type ServiceClient = ReturnType<typeof createServiceClient>;

const WEIGHT_DIFF_MAX_RATIO = 0.15;
const VOLUME_DIFF_MAX_RATIO = 0.20;
const HIGH_CONFIDENCE_MIN_SAMPLES = 8;
const HIGH_CONFIDENCE_MAX_AGE_DAYS = 60;
const MEDIUM_CONFIDENCE_MIN_SAMPLES = 3;
const INSUFFICIENT_DATA_MAX_SAMPLES = 1;
const MAX_CARRIERS_RETURNED = 5;

export type EstimationConfidence = 'insufficient_data' | 'low' | 'medium' | 'high';

export interface CarrierEstimation {
  carrier: string;
  sampleSize: number;
  confidence: EstimationConfidence;
  minCost: number;
  medianCost: number;
  maxCost: number;
  mostRecentObservedAt: string;
  freshnessDays: number;
}

export interface ProfileEstimation {
  packagingProfileId: string;
  packagingProfileName: string;
  sampleSize: number;
  confidence: EstimationConfidence;
  minCost: number | null;
  medianCost: number | null;
  maxCost: number | null;
  mostRecentObservedAt: string | null;
  freshnessDays: number | null;
  nextBoundary: { deltaKg: number; nextCost: number } | null;
  /** Décomposé par transporteur, trié du moins cher au plus cher — c'est
   *  cette liste, pas la plage agrégée ci-dessus, qui doit être présentée en
   *  premier : mélanger tous les transporteurs éligibles produit une plage
   *  large et peu actionnable (ex. 9,82–20,69 € sur un même scénario). */
  byCarrier: CarrierEstimation[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

function volumeOf(profile: Pick<ShippingPackagingProfileRow, 'box_length_cm' | 'box_width_cm' | 'box_height_cm'>): number {
  return profile.box_length_cm * profile.box_width_cm * profile.box_height_cm;
}

function confidenceFor(sampleSize: number, mostRecentObservedAt: string | null): EstimationConfidence {
  if (sampleSize <= INSUFFICIENT_DATA_MAX_SAMPLES) return 'insufficient_data';
  const freshEnough = mostRecentObservedAt ? daysSince(mostRecentObservedAt) < HIGH_CONFIDENCE_MAX_AGE_DAYS : false;
  if (sampleSize >= HIGH_CONFIDENCE_MIN_SAMPLES && freshEnough) return 'high';
  if (sampleSize >= MEDIUM_CONFIDENCE_MIN_SAMPLES) return 'medium';
  return 'low';
}

/**
 * Moteur de similarité déterministe (aucune IA/embedding) : filtre les
 * observations "choisies" (éligibles) par contraintes dures, puis calcule
 * une plage de coût + un niveau de confiance explicite, décomposée par
 * transporteur. Voir §6 de la proposition. Jamais présenté comme un prix
 * garanti.
 */
export async function estimateForProfile(
  supabase: ServiceClient,
  params: {
    tenantId: string;
    provider: string;
    originCountry: string;
    originPostalCode: string;
    destinationCountry: string;
    destinationZoneCode: string | null;
    numParcels: number;
    totalWeightG: number;
    profile: ShippingPackagingProfileRow;
  },
): Promise<ProfileEstimation> {
  const targetVolume = volumeOf(params.profile);
  const weightTolerance = params.totalWeightG * WEIGHT_DIFF_MAX_RATIO;

  const { data } = await supabase
    .from('shipping_quote_observations')
    .select('*')
    .eq('tenant_id', params.tenantId)
    .eq('provider', params.provider)
    .eq('origin_country', params.originCountry)
    .eq('destination_country', params.destinationCountry)
    .eq('num_parcels', params.numParcels)
    .eq('eligible', true)
    .eq('packaging_profile_id', params.profile.id)
    .gte('total_weight_g', Math.round(params.totalWeightG - weightTolerance))
    .lte('total_weight_g', Math.round(params.totalWeightG + weightTolerance))
    .order('observed_at', { ascending: false })
    .limit(200);

  const rows = (data ?? []) as ShippingQuoteObservationRow[];

  const zoneFiltered = params.destinationZoneCode
    ? rows.filter((r) => r.destination_zone_code === params.destinationZoneCode)
    : rows;
  const pool = zoneFiltered.length > 0 ? zoneFiltered : rows;

  const candidates = pool.filter((r) => {
    // Comparaison par colis (volume moyen), pas par somme totale : deux
    // observations à num_parcels différent ont déjà été exclues par le
    // .eq('num_parcels', ...) ci-dessus, donc comparer le volume total
    // gonflerait artificiellement l'écart avec le volume par colis du
    // profil cible dès que num_parcels > 1.
    const perParcelVolume = r.parcels.length > 0
      ? r.parcels.reduce((sum, p) => sum + p.length_cm * p.width_cm * p.height_cm, 0) / r.parcels.length
      : 0;
    if (perParcelVolume === 0 || targetVolume === 0) return true;
    return Math.abs(perParcelVolume - targetVolume) / targetVolume <= VOLUME_DIFF_MAX_RATIO;
  }).filter((r) => r.total_provider_cost != null);

  const costs = candidates.map((r) => r.total_provider_cost as number);
  const sampleSize = costs.length;
  const mostRecentObservedAt = candidates[0]?.observed_at ?? null;
  const confidence = confidenceFor(sampleSize, mostRecentObservedAt);

  // Décomposition par transporteur — voir doc-comment de ProfileEstimation.
  const carrierGroups = new Map<string, ShippingQuoteObservationRow[]>();
  for (const row of candidates) {
    const key = row.carrier?.trim() || 'Transporteur inconnu';
    const group = carrierGroups.get(key);
    if (group) group.push(row);
    else carrierGroups.set(key, [row]);
  }
  const byCarrier: CarrierEstimation[] = Array.from(carrierGroups.entries())
    .map(([carrier, carrierRows]) => {
      const carrierCosts = carrierRows.map((r) => r.total_provider_cost as number);
      const carrierMostRecent = carrierRows.reduce(
        (latest, r) => (r.observed_at > latest ? r.observed_at : latest), carrierRows[0]!.observed_at,
      );
      return {
        carrier,
        sampleSize: carrierRows.length,
        confidence: confidenceFor(carrierRows.length, carrierMostRecent),
        minCost: Math.min(...carrierCosts),
        medianCost: parseFloat(median(carrierCosts).toFixed(2)),
        maxCost: Math.max(...carrierCosts),
        mostRecentObservedAt: carrierMostRecent,
        freshnessDays: daysSince(carrierMostRecent),
      };
    })
    .sort((a, b) => a.medianCost - b.medianCost)
    .slice(0, MAX_CARRIERS_RETURNED);

  // Prochain palier : observation la moins chère au-dessus du poids cible
  // dont le coût médian diffère significativement de la plage courante.
  let nextBoundary: ProfileEstimation['nextBoundary'] = null;
  if (sampleSize > 0) {
    const currentMedian = median(costs);
    const heavier = pool
      .filter((r) => r.total_weight_g > params.totalWeightG && r.total_provider_cost != null)
      .sort((a, b) => a.total_weight_g - b.total_weight_g);
    const nextStep = heavier.find((r) => Math.abs((r.total_provider_cost as number) - currentMedian) >= 0.5);
    if (nextStep) {
      nextBoundary = {
        deltaKg: parseFloat(((nextStep.total_weight_g - params.totalWeightG) / 1000).toFixed(2)),
        nextCost: nextStep.total_provider_cost as number,
      };
    }
  }

  return {
    packagingProfileId: params.profile.id,
    packagingProfileName: params.profile.name,
    sampleSize,
    confidence,
    minCost: sampleSize > 0 ? Math.min(...costs) : null,
    medianCost: sampleSize > 0 ? parseFloat(median(costs).toFixed(2)) : null,
    maxCost: sampleSize > 0 ? Math.max(...costs) : null,
    mostRecentObservedAt,
    freshnessDays: mostRecentObservedAt ? daysSince(mostRecentObservedAt) : null,
    nextBoundary,
    byCarrier,
  };
}
