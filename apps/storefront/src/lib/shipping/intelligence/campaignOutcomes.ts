import type { createServiceClient } from '@/lib/supabase/server';

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * Codes d'erreur d'item qui décrivent la DONNÉE (le scénario n'a pas de devis
 * exploitable) et non un incident d'exécution. Ils restent `failed` dans la
 * campagne, mais ne font pas échouer le tick du scheduler (n8n / GitHub) :
 * seuls les incidents d'infrastructure le font.
 */
export const DATA_OUTCOME_ERRORS: ReadonlySet<string> = new Set([
  'provider_rejected',
  'provider_rejected_known_destination',
  'no_service',
  'no_eligible_service',
  'packaging_profile_not_found',
]);

/** Destination refusée par Packlink : inutile de la remesurer telle quelle. */
export const REJECTED_DESTINATION_ERRORS: ReadonlySet<string> = new Set([
  'provider_rejected',
  'provider_rejected_known_destination',
]);

export function isDataOutcomeError(error: string | null | undefined): boolean {
  return Boolean(error && DATA_OUTCOME_ERRORS.has(error));
}

/**
 * Un CAP est considéré comme refusé par Packlink dès que deux poids distincts
 * ont été refusés (HTTP 400/404/422) pour ce tenant dans la fenêtre donnée :
 * le refus ne dépend alors pas du colis. Les scénarios suivants de ce CAP sont
 * clôturés sans nouvel appel.
 */
export const MIN_REJECTED_WEIGHTS_FOR_DESTINATION = 2;

export function rejectedWeightsProveDestination(weightsKg: number[]): boolean {
  return new Set(weightsKg).size >= MIN_REJECTED_WEIGHTS_FOR_DESTINATION;
}

export async function isKnownRejectedDestination(
  supabase: ServiceClient,
  params: { tenantId: string; country: string; postalCode: string; sinceIso: string },
): Promise<boolean> {
  const { data, error } = await supabase
    .from('shipping_simulation_campaign_items')
    .select('scenario')
    .eq('tenant_id', params.tenantId)
    .eq('status', 'failed')
    .eq('error', 'provider_rejected')
    .eq('scenario->destination->>country', params.country)
    .eq('scenario->destination->>postalCode', params.postalCode)
    .gte('attempted_at', params.sinceIso)
    .limit(20);
  if (error || !data) return false;
  return rejectedWeightsProveDestination(
    (data as Array<{ scenario: { weightKg: number } }>).map((row) => Number(row.scenario?.weightKg)),
  );
}
