import {
  fetchAllPacklinkServices,
  isEligibleService,
  getExclusionReason,
  describePacklinkService,
} from '@/lib/shipping/calculateShipping';
import { buildScenarioRequest, INTELLIGENCE_FROM_ADDRESS } from './requestIdentity';
import { chooseOperationalOffer, operationalCost } from './operationalObservation';
import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingObservationSource, ShippingPackagingProfileRow } from '@lepefy/types';

type ServiceClient = ReturnType<typeof createServiceClient>;

export { INTELLIGENCE_FROM_ADDRESS };

/**
 * Issue d'une exécution de scénario. Seul `ok: true` constitue un devis
 * exploitable (une observation opérationnelle choisie existe) :
 *  - provider_error            : appel Packlink en échec, rien de persisté ;
 *  - no_service                : Packlink n'a renvoyé aucun service, rien de persisté ;
 *  - no_eligible_service       : services reçus et persistés (avec motif
 *                                d'exclusion) mais aucun n'est éligible ;
 *  - persistence_error         : devis reçu mais écriture impossible ;
 *  - chosen_observation_missing: offres écrites mais l'observation choisie
 *                                n'a pas été retrouvée dans le retour d'insert.
 */
export type ScenarioQuoteFailureReason =
  | 'provider_error'
  | 'no_service'
  | 'no_eligible_service'
  | 'persistence_error'
  | 'chosen_observation_missing';

export type ScenarioQuoteResult =
  | { ok: true; chosenObservationId: string; offersCount: number; eligibleCount: number }
  | { ok: false; reason: ScenarioQuoteFailureReason; error: string; offersPersisted: boolean };

/**
 * Interroge Packlink pour un scénario (poids, profil d'emballage,
 * destination) et persiste UNE ligne shipping_quote_observations par service
 * retourné (éligible ou non, avec le motif d'exclusion) — les alternatives
 * restent disponibles pour l'analyse par transporteur/service. Désigne
 * ensuite UNE observation opérationnelle : le service éligible au coût total
 * (base + taxes) le plus bas. Ce coût est un devis, jamais une facture.
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

  const request = buildScenarioRequest({ weightKg, profile, destination });

  let services;
  try {
    services = await fetchAllPacklinkServices(
      packlinkApiKey,
      INTELLIGENCE_FROM_ADDRESS,
      { country: request.destinationCountry, zip_code: request.destinationPostalCode },
      request.parcels.map((p) => ({
        weight: parseFloat((p.weight_g / 1000).toFixed(3)),
        width: p.width_cm,
        height: p.height_cm,
        length: p.length_cm,
      })),
    );
  } catch (err) {
    return { ok: false, reason: 'provider_error', error: err instanceof Error ? err.message : 'provider_error', offersPersisted: false };
  }

  if (services === null) {
    return { ok: false, reason: 'provider_error', error: 'provider_error', offersPersisted: false };
  }
  if (services.length === 0) {
    return { ok: false, reason: 'no_service', error: 'no_service', offersPersisted: false };
  }

  const chosen = chooseOperationalOffer(services.map((s) => ({
    id: s.id,
    eligible: isEligibleService(s),
    basePrice: Number(s.price.base_price),
    taxPrice: Number(s.price.tax_price ?? 0),
  })));

  const rows = services.map((s) => {
    const { carrierName, serviceName } = describePacklinkService(s);
    return {
      tenant_id: tenantId,
      provider: request.provider,
      source,
      campaign_id: campaignId,
      origin_country: request.originCountry,
      origin_postal_code: request.originPostalCode,
      destination_country: request.destinationCountry,
      destination_postal_code: request.destinationPostalCode,
      destination_zone_code: destination.zoneCode ?? null,
      num_parcels: request.numParcels,
      parcels: request.parcels,
      total_weight_g: request.totalWeightG,
      packaging_profile_id: profile.id,
      service_id: String(s.id),
      carrier: carrierName || null,
      service_name: serviceName || null,
      base_price: s.price.base_price,
      tax_price: s.price.tax_price ?? 0,
      total_provider_cost: operationalCost({ base_price: s.price.base_price, tax_price: s.price.tax_price ?? 0 }),
      eligible: isEligibleService(s),
      exclusion_reason: getExclusionReason(s),
      request_hash: request.requestHash,
    };
  });

  const { data: inserted, error: insertError } = await supabase
    .from('shipping_quote_observations')
    .insert(rows)
    .select('id, service_id');

  if (insertError) {
    return { ok: false, reason: 'persistence_error', error: `persistence_error: ${insertError.message}`, offersPersisted: false };
  }

  const eligibleCount = rows.filter((r) => r.eligible).length;
  if (!chosen) {
    return { ok: false, reason: 'no_eligible_service', error: 'no_eligible_service', offersPersisted: true };
  }

  const chosenObservation = (inserted as { id: string; service_id: string }[] | null)
    ?.find((r) => r.service_id === String(chosen.id));
  if (!chosenObservation) {
    return { ok: false, reason: 'chosen_observation_missing', error: 'chosen_observation_missing', offersPersisted: true };
  }

  return { ok: true, chosenObservationId: chosenObservation.id, offersCount: rows.length, eligibleCount };
}
