import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingPackagingProfileRow, ShippingQuoteObservationRow } from '@lepefy/types';
import { fetchAllPages } from './pagedQuery';
import { latestValidPerScenario } from './operationalObservation';

type ServiceClient = ReturnType<typeof createServiceClient>;

const MAX_OFFER_ROWS = 20_000;

export interface ObservationSummaryGroup {
  destination: string;
  packagingProfile: string;
  /** Scénarios distincts mesurés (une observation opérationnelle chacun). */
  sampleSize: number;
  /** CAP distincts couverts par ces scénarios. */
  postalCodes: number;
  medianCost: number;
  minCost: number;
  maxCost: number;
  mostRecentObservedAt: string;
  confidence: 'high' | 'medium' | 'low';
}

type SummaryObservation = Pick<ShippingQuoteObservationRow,
  | 'id' | 'request_hash' | 'observed_at' | 'eligible' | 'total_provider_cost' | 'packaging_profile_id'
  | 'destination_zone_code' | 'destination_country' | 'destination_postal_code'>;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Agrégation pure — exportée pour les tests. */
export function summarizeObservations(
  rows: SummaryObservation[],
  profileNames: Map<string, string>,
): { scenariosMeasured: number; groups: ObservationSummaryGroup[] } {
  const scenarios = latestValidPerScenario(rows);
  const groups = new Map<string, { destination: string; profile: string; costs: number[]; postal: Set<string>; mostRecent: string }>();

  for (const { chosen } of scenarios) {
    if (chosen.total_provider_cost == null || !chosen.packaging_profile_id) continue;
    const destination = chosen.destination_zone_code ?? chosen.destination_country;
    const profileName = profileNames.get(chosen.packaging_profile_id) ?? 'Profil supprimé';
    const key = `${destination}::${profileName}`;
    const cost = Number(chosen.total_provider_cost);
    const existing = groups.get(key);
    if (existing) {
      existing.costs.push(cost);
      existing.postal.add(`${chosen.destination_country}|${chosen.destination_postal_code}`);
      if (chosen.observed_at > existing.mostRecent) existing.mostRecent = chosen.observed_at;
    } else {
      groups.set(key, {
        destination, profile: profileName, costs: [cost],
        postal: new Set([`${chosen.destination_country}|${chosen.destination_postal_code}`]),
        mostRecent: chosen.observed_at,
      });
    }
  }

  const summary: ObservationSummaryGroup[] = Array.from(groups.values())
    .map((g) => ({
      destination: g.destination,
      packagingProfile: g.profile,
      sampleSize: g.costs.length,
      postalCodes: g.postal.size,
      medianCost: parseFloat(median(g.costs).toFixed(2)),
      minCost: Math.min(...g.costs),
      maxCost: Math.max(...g.costs),
      mostRecentObservedAt: g.mostRecent,
      confidence: (g.costs.length >= 8 ? 'high' : g.costs.length >= 3 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
    }))
    .sort((a, b) => b.sampleSize - a.sampleSize);

  return { scenariosMeasured: scenarios.length, groups: summary };
}

/**
 * Agrégats lisibles par zone/profil pour l'onglet "Historique des coûts" —
 * jamais une liste brute de milliers de lignes. L'échantillon compte des
 * SCÉNARIOS mesurés (dernier devis valide de chacun, service éligible au coût
 * total le plus bas), pas les offres alternatives renvoyées par Packlink.
 */
export async function buildObservationsSummary(
  supabase: ServiceClient,
  tenantId: string,
): Promise<{ totalObservations: number; offersRead: number; scenariosMeasured: number; truncated: boolean; groups: ObservationSummaryGroup[] }> {
  const [offers, { data: profileRows }, { count: totalCount }] = await Promise.all([
    fetchAllPages<SummaryObservation>((from, to) => supabase
      .from('shipping_quote_observations')
      .select('id, request_hash, observed_at, eligible, total_provider_cost, packaging_profile_id, destination_zone_code, destination_country, destination_postal_code')
      .eq('tenant_id', tenantId)
      .eq('eligible', true)
      .not('total_provider_cost', 'is', null)
      .order('observed_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: SummaryObservation[] | null; error: { message: string } | null }>,
    { maxRows: MAX_OFFER_ROWS }),
    supabase.from('shipping_packaging_profiles').select('*').eq('tenant_id', tenantId),
    supabase.from('shipping_quote_observations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
  ]);

  const profileNames = new Map((profileRows as ShippingPackagingProfileRow[] | null ?? []).map((p) => [p.id, p.name]));
  const { scenariosMeasured, groups } = summarizeObservations(offers.rows, profileNames);

  return {
    totalObservations: totalCount ?? 0,
    offersRead: offers.rows.length,
    scenariosMeasured,
    truncated: offers.truncated,
    groups,
  };
}
