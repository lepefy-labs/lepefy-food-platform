import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingQuoteObservationRow } from '@lepefy/types';

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface EquivalenceQuery {
  tenantId: string;
  provider: string;
  originCountry: string;
  originPostalCode: string;
  destinationCountry: string;
  destinationZoneCode: string | null;
  destinationPostalCode: string;
  numParcels: number;
  totalWeightG: number;
  volumeCm3: number;
  freshnessWindowDays: number;
}

const WEIGHT_TOLERANCE_RATIO = 0.05;
const WEIGHT_TOLERANCE_FLOOR_G = 250;
const VOLUME_TOLERANCE_RATIO = 0.10;

/**
 * Une observation existante "couvre" un scénario quand tout ce qui suit
 * correspond : même provider/origine/destination (pays + zone si connue)/
 * nombre de colis, poids à ±5% (ou ±250g, le plus grand des deux), volume à
 * ±10%, et observée dans la fenêtre de fraîcheur demandée. Utilisé pour
 * éviter un appel Packlink redondant — voir §5 de la proposition.
 */
export async function findEquivalentObservation(
  supabase: ServiceClient,
  query: EquivalenceQuery,
): Promise<ShippingQuoteObservationRow | null> {
  const sinceIso = new Date(Date.now() - query.freshnessWindowDays * 24 * 60 * 60 * 1000).toISOString();
  const weightTolerance = Math.max(query.totalWeightG * WEIGHT_TOLERANCE_RATIO, WEIGHT_TOLERANCE_FLOOR_G);

  const { data, error } = await supabase
    .from('shipping_quote_observations')
    .select('*')
    .eq('tenant_id', query.tenantId)
    .eq('provider', query.provider)
    .eq('origin_country', query.originCountry)
    .eq('origin_postal_code', query.originPostalCode)
    .eq('destination_country', query.destinationCountry)
    .eq('num_parcels', query.numParcels)
    .eq('eligible', true)
    .gte('observed_at', sinceIso)
    .gte('total_weight_g', Math.round(query.totalWeightG - weightTolerance))
    .lte('total_weight_g', Math.round(query.totalWeightG + weightTolerance))
    .order('observed_at', { ascending: false })
    .limit(20);

  if (error || !data?.length) return null;

  const rows = data as ShippingQuoteObservationRow[];

  // Filtre destination STRICT, sans repli sur `rows` non filtrées : contrairement
  // à l'estimation de similarity.ts (où élargir la recherche est acceptable —
  // le résultat reste étiqueté avec sa taille d'échantillon et sa confiance),
  // ici un repli aurait fait considérer N'IMPORTE QUELLE observation italienne
  // à un poids proche comme "équivalente" dès qu'un nouveau code postal
  // (encore jamais observé) était testé — ce qui a fait passer une campagne de
  // 1406 scénarios en 100% "doublon", 0% appel Packlink réel, sans construire
  // la moindre nouvelle donnée pour les nouvelles villes couvertes.
  const candidates = query.destinationZoneCode
    ? rows.filter((r) => r.destination_zone_code === query.destinationZoneCode)
    : rows.filter((r) => r.destination_postal_code === query.destinationPostalCode);

  const match = candidates.find((r) => {
    // Volume moyen par colis, pas somme totale — num_parcels est déjà
    // exact-matché ci-dessus ; comparer le volume total gonflerait l'écart
    // avec le volume par colis (query.volumeCm3) dès que num_parcels > 1.
    const perParcelVolume = r.parcels.length > 0
      ? r.parcels.reduce((sum, p) => sum + p.length_cm * p.width_cm * p.height_cm, 0) / r.parcels.length
      : 0;
    if (perParcelVolume === 0 || query.volumeCm3 === 0) return true;
    const volumeDiff = Math.abs(perParcelVolume - query.volumeCm3) / query.volumeCm3;
    return volumeDiff <= VOLUME_TOLERANCE_RATIO;
  });

  return match ?? null;
}
