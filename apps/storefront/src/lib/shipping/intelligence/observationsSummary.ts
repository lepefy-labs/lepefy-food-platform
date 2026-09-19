import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingPackagingProfileRow, ShippingQuoteObservationRow } from '@lepefy/types';

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface ObservationSummaryGroup {
  destination: string;
  packagingProfile: string;
  sampleSize: number;
  medianCost: number;
  minCost: number;
  maxCost: number;
  mostRecentObservedAt: string;
  confidence: 'high' | 'medium' | 'low';
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Agrégats lisibles par zone/profil pour l'onglet "Historique des coûts" —
 * jamais une liste brute de milliers de lignes (contrainte de performance).
 */
export async function buildObservationsSummary(
  supabase: ServiceClient,
  tenantId: string,
): Promise<{ totalObservations: number; eligibleSampled: number; groups: ObservationSummaryGroup[] }> {
  const [{ data: observations }, { data: profileRows }, { count: totalCount }] = await Promise.all([
    supabase
      .from('shipping_quote_observations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('eligible', true)
      .order('observed_at', { ascending: false })
      .limit(2000),
    supabase.from('shipping_packaging_profiles').select('*').eq('tenant_id', tenantId),
    supabase.from('shipping_quote_observations').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
  ]);

  const rows = (observations as ShippingQuoteObservationRow[] | null) ?? [];
  const profilesById = new Map((profileRows as ShippingPackagingProfileRow[] | null ?? []).map((p) => [p.id, p.name]));

  const groups = new Map<string, { destination: string; profile: string; costs: number[]; mostRecent: string }>();
  for (const row of rows) {
    if (row.total_provider_cost == null || !row.packaging_profile_id) continue;
    const destination = row.destination_zone_code ?? row.destination_country;
    const profileName = profilesById.get(row.packaging_profile_id) ?? 'Profil supprimé';
    const key = `${destination}::${profileName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.costs.push(row.total_provider_cost);
      if (row.observed_at > existing.mostRecent) existing.mostRecent = row.observed_at;
    } else {
      groups.set(key, { destination, profile: profileName, costs: [row.total_provider_cost], mostRecent: row.observed_at });
    }
  }

  const summary: ObservationSummaryGroup[] = Array.from(groups.values())
    .map((g) => ({
      destination: g.destination,
      packagingProfile: g.profile,
      sampleSize: g.costs.length,
      medianCost: parseFloat(median(g.costs).toFixed(2)),
      minCost: Math.min(...g.costs),
      maxCost: Math.max(...g.costs),
      mostRecentObservedAt: g.mostRecent,
      confidence: (g.costs.length >= 8 ? 'high' : g.costs.length >= 3 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
    }))
    .sort((a, b) => b.sampleSize - a.sampleSize);

  return { totalObservations: totalCount ?? 0, eligibleSampled: rows.length, groups: summary };
}
