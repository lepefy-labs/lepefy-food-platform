import { splitIntoParcels } from '@/lib/shipping/calculateShipping';
import { computeRequestHash } from './requestHash';
import type { ShippingObservationParcel, ShippingPackagingProfileRow, ShippingQuoteObservationRow } from '@lepefy/types';

// Même adresse d'expédition que /api/shipping/quote et le simulateur admin —
// dupliquée ici volontairement, cf. convention établie (ne pas toucher au
// fichier de flux réel pour exporter une valeur interne).
export const INTELLIGENCE_FROM_ADDRESS = { country: 'IT', zip_code: '42122' };
export const INTELLIGENCE_PROVIDER = 'packlink';

/**
 * Identité effective d'une demande de devis : exactement ce qui est envoyé au
 * provider (origine, pays + CAP de destination, colis avec poids et
 * dimensions). La zone commerciale n'en fait PAS partie — deux CAP d'une même
 * zone sont deux demandes différentes.
 */
export interface ScenarioRequest {
  provider: string;
  originCountry: string;
  originPostalCode: string;
  destinationCountry: string;
  destinationPostalCode: string;
  numParcels: number;
  totalWeightG: number;
  parcels: ShippingObservationParcel[];
  requestHash: string;
}

/** Trim + majuscules, zéros initiaux conservés (un CAP reste une chaîne). */
export function normalizePostalCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function buildScenarioRequest(params: {
  weightKg: number;
  profile: Pick<ShippingPackagingProfileRow, 'box_length_cm' | 'box_width_cm' | 'box_height_cm' | 'max_weight_g'>;
  destination: { country: string; postalCode: string };
}): ScenarioRequest {
  const { weightKg, profile } = params;
  const totalWeightG = Math.round(weightKg * 1000);
  const parcelWeightsG = splitIntoParcels(totalWeightG, profile.max_weight_g / 1000);
  const parcels = parcelWeightsG.map((g) => ({
    weight_g: g,
    length_cm: Number(profile.box_length_cm),
    width_cm: Number(profile.box_width_cm),
    height_cm: Number(profile.box_height_cm),
  }));
  const destinationCountry = params.destination.country.trim().toUpperCase();
  const destinationPostalCode = normalizePostalCode(params.destination.postalCode);

  return {
    provider: INTELLIGENCE_PROVIDER,
    originCountry: INTELLIGENCE_FROM_ADDRESS.country,
    originPostalCode: INTELLIGENCE_FROM_ADDRESS.zip_code,
    destinationCountry,
    destinationPostalCode,
    numParcels: parcels.length,
    totalWeightG,
    parcels,
    requestHash: computeRequestHash({
      provider: INTELLIGENCE_PROVIDER,
      originCountry: INTELLIGENCE_FROM_ADDRESS.country,
      originPostalCode: INTELLIGENCE_FROM_ADDRESS.zip_code,
      destinationCountry,
      destinationPostalCode,
      numParcels: parcels.length,
      parcels: parcels.map((p) => ({ weightG: p.weight_g, lengthCm: p.length_cm, widthCm: p.width_cm, heightCm: p.height_cm })),
    }),
  };
}

export type IdentityMismatch =
  | 'tenant'
  | 'provider'
  | 'origin'
  | 'destination_country'
  | 'destination_postal_code'
  | 'total_weight'
  | 'num_parcels'
  | 'parcels';

function parcelSignature(parcels: ShippingObservationParcel[]): string {
  return [...(parcels ?? [])]
    .map((p) => `${Number(p.weight_g)}x${Number(p.length_cm)}x${Number(p.width_cm)}x${Number(p.height_cm)}`)
    .sort()
    .join('|');
}

type ObservationIdentityFields = Pick<ShippingQuoteObservationRow,
  | 'tenant_id' | 'provider' | 'origin_country' | 'origin_postal_code' | 'destination_country'
  | 'destination_postal_code' | 'total_weight_g' | 'num_parcels' | 'parcels'>;

/**
 * Vérifie qu'une observation correspond STRICTEMENT à la demande — le hash
 * seul ne suffit pas (formule susceptible d'évoluer, collisions, lignes
 * historiques). Retourne la première divergence, ou null si identique.
 */
export function compareObservationToRequest(
  observation: ObservationIdentityFields,
  request: ScenarioRequest,
  tenantId: string,
): IdentityMismatch | null {
  if (observation.tenant_id !== tenantId) return 'tenant';
  if (observation.provider !== request.provider) return 'provider';
  if (observation.origin_country !== request.originCountry || observation.origin_postal_code !== request.originPostalCode) return 'origin';
  if (observation.destination_country.trim().toUpperCase() !== request.destinationCountry) return 'destination_country';
  if (normalizePostalCode(observation.destination_postal_code) !== request.destinationPostalCode) return 'destination_postal_code';
  if (Number(observation.total_weight_g) !== request.totalWeightG) return 'total_weight';
  if (Number(observation.num_parcels) !== request.numParcels) return 'num_parcels';
  if (parcelSignature(observation.parcels) !== parcelSignature(request.parcels)) return 'parcels';
  return null;
}
