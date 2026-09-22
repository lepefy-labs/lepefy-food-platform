import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingPackagingProfileRow, ShippingQuoteObservationRow } from '@lepefy/types';
import { latestValidPerScenario } from './operationalObservation';

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
 * Moteur de similarité déterministe (aucune IA/embedding) : filtre les offres
 * éligibles par contraintes dures, avec des TOLÉRANCES de poids/volume (±15 %
 * / ±20 %) acceptables ici parce que le résultat est présenté comme une
 * ESTIMATION (taille d'échantillon + confiance) — contrairement au réemploi en
 * campagne, qui exige une demande strictement identique. L'échantillon compte
 * des scénarios mesurés, pas les offres alternatives. Jamais un prix garanti.
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
    .limit(1000);

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

  // Un échantillon = un scénario mesuré (request_hash), valorisé par
  // l'observation opérationnelle de son devis le plus récent — jamais une
  // offre alternative du même devis ni une ré-exécution du même scénario.
  const scenarios = latestValidPerScenario(candidates);
  const operational = scenarios.map((s) => s.chosen);
  const costs = operational.map((r) => Number(r.total_provider_cost));
  const sampleSize = costs.length;
  const mostRecentObservedAt = operational.reduce<string | null>(
    (latest, r) => (latest === null || r.observed_at > latest ? r.observed_at : latest), null,
  );
  const confidence = confidenceFor(sampleSize, mostRecentObservedAt);

  // Décomposition par transporteur (alternatives conservées pour l'analyse) :
  // pour chaque scénario, l'offre la moins chère de chaque transporteur dans
  // le devis retenu — un scénario compte au plus une fois par transporteur.
  const carrierGroups = new Map<string, { costs: number[]; mostRecent: string }>();
  for (const { execution } of scenarios) {
    const bestByCarrier = new Map<string, ShippingQuoteObservationRow>();
    for (const offer of execution.offers) {
      const key = offer.carrier?.trim() || 'Transporteur inconnu';
      const current = bestByCarrier.get(key);
      if (!current || Number(offer.total_provider_cost) < Number(current.total_provider_cost)) bestByCarrier.set(key, offer);
    }
    for (const [carrier, offer] of bestByCarrier) {
      const group = carrierGroups.get(carrier);
      if (group) {
        group.costs.push(Number(offer.total_provider_cost));
        if (offer.observed_at > group.mostRecent) group.mostRecent = offer.observed_at;
      } else {
        carrierGroups.set(carrier, { costs: [Number(offer.total_provider_cost)], mostRecent: offer.observed_at });
      }
    }
  }
  const byCarrier: CarrierEstimation[] = Array.from(carrierGroups.entries())
    .map(([carrier, group]) => ({
      carrier,
      sampleSize: group.costs.length,
      confidence: confidenceFor(group.costs.length, group.mostRecent),
      minCost: Math.min(...group.costs),
      medianCost: parseFloat(median(group.costs).toFixed(2)),
      maxCost: Math.max(...group.costs),
      mostRecentObservedAt: group.mostRecent,
      freshnessDays: daysSince(group.mostRecent),
    }))
    .sort((a, b) => a.medianCost - b.medianCost)
    .slice(0, MAX_CARRIERS_RETURNED);

  // Prochain palier : scénario (observation opérationnelle) le plus léger
  // au-dessus du poids cible dont le coût diffère significativement.
  let nextBoundary: ProfileEstimation['nextBoundary'] = null;
  if (sampleSize > 0) {
    const currentMedian = median(costs);
    const heavier = latestValidPerScenario(pool.filter((r) => r.total_provider_cost != null))
      .map((s) => s.chosen)
      .filter((r) => r.total_weight_g > params.totalWeightG)
      .sort((a, b) => a.total_weight_g - b.total_weight_g);
    const nextStep = heavier.find((r) => Math.abs(Number(r.total_provider_cost) - currentMedian) >= 0.5);
    if (nextStep) {
      nextBoundary = {
        deltaKg: parseFloat(((nextStep.total_weight_g - params.totalWeightG) / 1000).toFixed(2)),
        nextCost: Number(nextStep.total_provider_cost),
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
