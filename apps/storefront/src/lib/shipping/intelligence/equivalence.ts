import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingQuoteObservationRow } from '@lepefy/types';
import { compareObservationToRequest, type ScenarioRequest } from './requestIdentity';
import { groupQuoteExecutions } from './operationalObservation';

type ServiceClient = ReturnType<typeof createServiceClient>;

// Lignes candidates lues pour un même request_hash : ~20 services par
// exécution, donc une dizaine d'exécutions récentes. Au-delà, on préfère un
// nouvel appel plutôt qu'un réemploi approximatif.
const MAX_CANDIDATE_ROWS = 200;

/**
 * Sélection pure : parmi des lignes candidates (même tenant + même hash,
 * dans la fenêtre de fraîcheur), retient l'observation opérationnelle de
 * l'exécution valide la plus récente dont l'identité correspond STRICTEMENT
 * à la demande (tenant, provider, origine, pays + CAP, poids total, colis).
 * Aucune tolérance de poids/volume et aucune substitution par la zone :
 * c'est un réemploi de devis identique, pas une estimation.
 */
export function pickReusableObservation<T extends ShippingQuoteObservationRow>(
  rows: T[],
  request: ScenarioRequest,
  tenantId: string,
  sinceIso: string,
): T | null {
  const identical = rows.filter((row) =>
    row.request_hash === request.requestHash
    && Date.parse(row.observed_at) >= Date.parse(sinceIso)
    && compareObservationToRequest(row, request, tenantId) === null,
  );
  const execution = groupQuoteExecutions(identical).find((e) => e.chosen !== null);
  return execution?.chosen ?? null;
}

/**
 * Cherche un devis strictement identique encore frais pour éviter un appel
 * Packlink redondant. Filtre en base sur tenant + request_hash AVANT toute
 * limite (pas de LIMIT appliqué à un ensemble plus large filtré ensuite en
 * mémoire), puis vérifie la sémantique ligne par ligne.
 */
export async function findReusableObservation(
  supabase: ServiceClient,
  params: { tenantId: string; request: ScenarioRequest; freshnessWindowDays: number; now?: number },
): Promise<ShippingQuoteObservationRow | null> {
  const sinceIso = new Date((params.now ?? Date.now()) - params.freshnessWindowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('shipping_quote_observations')
    .select('*')
    .eq('tenant_id', params.tenantId)
    .eq('request_hash', params.request.requestHash)
    .eq('eligible', true)
    .gte('observed_at', sinceIso)
    .order('observed_at', { ascending: false })
    .limit(MAX_CANDIDATE_ROWS);

  if (error || !data?.length) return null;
  return pickReusableObservation(data as ShippingQuoteObservationRow[], params.request, params.tenantId, sinceIso);
}
