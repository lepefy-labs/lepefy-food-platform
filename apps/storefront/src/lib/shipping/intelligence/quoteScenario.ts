import {
  fetchAllPacklinkServices,
  isEligibleService,
  getExclusionReason,
  describePacklinkService,
  splitIntoParcels,
} from '@/lib/shipping/calculateShipping';
import { computeRequestHash } from './requestHash';
import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingObservationSource, ShippingPackagingProfileRow } from '@lepefy/types';

type ServiceClient = ReturnType<typeof createServiceClient>;

// Même adresse d'expédition que /api/shipping/quote et le simulateur admin —
// dupliquée ici volontairement, cf. convention établie (ne pas toucher au
// fichier de flux réel pour exporter une valeur interne).
export const INTELLIGENCE_FROM_ADDRESS = { country: 'IT', zip_code: '42122' };

export interface ScenarioQuoteResult {
  ok: boolean;
  chosenObservationId: string | null;
  error?: string;
}

/**
 * Interroge Packlink pour un scénario (poids, profil d'emballage,
 * destination) et persiste UNE ligne shipping_quote_observations par service
 * retourné (éligible ou non, avec le motif d'exclusion) — même niveau de
 * détail que le simulateur admin, mais conservé au lieu d'être jeté. Retourne
 * l'id de l'observation "choisie" (moins chère et éligible), s'il y en a une.
 */
export async function quoteScenarioAndPersist(params: {
  supabase: ServiceClient;
  tenantId: string;
  packlinkApiKey: string;
  source: ShippingObservationSource;
  campaignId: string | null;
  weightKg: number;
  profile: ShippingPackagingProfileRow;
  destination: { country: string; postalCode: string; zoneCode?: string | null };
}): Promise<ScenarioQuoteResult> {
  const { supabase, tenantId, packlinkApiKey, source, campaignId, weightKg, profile, destination } = params;

  const totalWeightG = Math.round(weightKg * 1000);
  const parcelWeightsG = splitIntoParcels(totalWeightG, profile.max_weight_g / 1000);
  const numParcels = parcelWeightsG.length;
  const to = { country: destination.country, zip_code: destination.postalCode };

  const parcelsForObservation = parcelWeightsG.map((g) => ({
    weight_g: g,
    length_cm: profile.box_length_cm,
    width_cm: profile.box_width_cm,
    height_cm: profile.box_height_cm,
  }));

  const requestHash = computeRequestHash({
    provider: 'packlink',
    originCountry: INTELLIGENCE_FROM_ADDRESS.country,
    originPostalCode: INTELLIGENCE_FROM_ADDRESS.zip_code,
    destinationCountry: destination.country,
    destinationPostalCode: destination.postalCode,
    numParcels,
    parcels: parcelWeightsG.map((g) => ({
      weightG: g, lengthCm: profile.box_length_cm, widthCm: profile.box_width_cm, heightCm: profile.box_height_cm,
    })),
  });

  let services;
  try {
    services = await fetchAllPacklinkServices(
      packlinkApiKey, INTELLIGENCE_FROM_ADDRESS, to,
      parcelWeightsG.map((g) => ({
        weight: parseFloat((g / 1000).toFixed(3)),
        width: profile.box_width_cm,
        height: profile.box_height_cm,
        length: profile.box_length_cm,
      })),
    );
  } catch (err) {
    return { ok: false, chosenObservationId: null, error: err instanceof Error ? err.message : 'packlink_error' };
  }

  if (services === null) {
    return { ok: false, chosenObservationId: null, error: 'packlink_error' };
  }
  if (services.length === 0) {
    return { ok: false, chosenObservationId: null, error: 'no_service' };
  }

  const eligible = services.filter(isEligibleService);
  const cheapest = eligible.length > 0
    ? eligible.reduce((min, s) => (s.price.base_price < min.price.base_price ? s : min))
    : null;

  const rows = services.map((s) => {
    const { carrierName, serviceName } = describePacklinkService(s);
    return {
      tenant_id: tenantId,
      provider: 'packlink',
      source,
      campaign_id: campaignId,
      origin_country: INTELLIGENCE_FROM_ADDRESS.country,
      origin_postal_code: INTELLIGENCE_FROM_ADDRESS.zip_code,
      destination_country: destination.country,
      destination_postal_code: destination.postalCode,
      destination_zone_code: destination.zoneCode ?? null,
      num_parcels: numParcels,
      parcels: parcelsForObservation,
      total_weight_g: totalWeightG,
      packaging_profile_id: profile.id,
      service_id: String(s.id),
      carrier: carrierName || null,
      service_name: serviceName || null,
      base_price: s.price.base_price,
      tax_price: s.price.tax_price ?? 0,
      total_provider_cost: parseFloat((s.price.base_price + (s.price.tax_price ?? 0)).toFixed(2)),
      eligible: isEligibleService(s),
      exclusion_reason: getExclusionReason(s),
      request_hash: requestHash,
    };
  });

  const { data: inserted, error: insertError } = await supabase
    .from('shipping_quote_observations')
    .insert(rows)
    .select('id, service_id');

  if (insertError) {
    return { ok: false, chosenObservationId: null, error: insertError.message };
  }

  const chosenObservation = cheapest
    ? (inserted as { id: string; service_id: string }[] | null)?.find((r) => r.service_id === String(cheapest.id))
    : null;

  return { ok: true, chosenObservationId: chosenObservation?.id ?? null };
}
