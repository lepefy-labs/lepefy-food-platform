import type { createServiceClient } from '@/lib/supabase/server';
import type {
  ShippingPackagingProfileRow,
  ShippingQuoteObservationRow,
  ShippingScenarioMatrix,
  ShippingSimulationCampaignItemRow,
  ShippingSimulationCampaignRow,
} from '@lepefy/types';
import { chunk, fetchAllPages } from './pagedQuery';
import { computeCampaignCoverage } from './campaignCoverage';

type ServiceClient = ReturnType<typeof createServiceClient>;

const DEFAULT_FRESHNESS_WINDOW_DAYS = 30;
// UUID × 150 ≈ 5,5 Ko d'URL : bien en deçà des limites HTTP/PostgREST.
const OBSERVATION_ID_CHUNK = 150;

/** Tous les items d'une campagne (≤ 2000), paginés — jamais un SELECT tronqué à 1000. */
export async function fetchCampaignItems(supabase: ServiceClient, tenantId: string, campaignId: string) {
  return fetchAllPages<ShippingSimulationCampaignItemRow>((from, to) => supabase
    .from('shipping_simulation_campaign_items')
    .select('id, campaign_id, tenant_id, scenario, status, observation_id, error, attempted_at, created_at')
    .eq('tenant_id', tenantId)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to) as unknown as PromiseLike<{ data: ShippingSimulationCampaignItemRow[] | null; error: { message: string } | null }>,
  { maxRows: 5000 });
}

/** Observations par id, par lots et TOUJOURS filtrées par tenant (une ligne d'un autre tenant = absente). */
export async function fetchObservationsByIds(
  supabase: ServiceClient,
  tenantId: string,
  ids: string[],
): Promise<Map<string, ShippingQuoteObservationRow>> {
  const unique = Array.from(new Set(ids));
  const out = new Map<string, ShippingQuoteObservationRow>();
  for (const idsChunk of chunk(unique, OBSERVATION_ID_CHUNK)) {
    const { data, error } = await supabase
      .from('shipping_quote_observations')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('id', idsChunk);
    if (error) throw new Error(`observations_lookup_failed: ${error.message}`);
    for (const row of (data ?? []) as ShippingQuoteObservationRow[]) out.set(row.id, row);
  }
  return out;
}

export async function loadCampaignCoverage(supabase: ServiceClient, tenantId: string, campaign: ShippingSimulationCampaignRow) {
  const itemsResult = await fetchCampaignItems(supabase, tenantId, campaign.id);
  if (itemsResult.error) throw new Error(`campaign_items_lookup_failed: ${itemsResult.error}`);

  const [observationsById, { data: profileRows }] = await Promise.all([
    fetchObservationsByIds(
      supabase,
      tenantId,
      itemsResult.rows.map((i) => i.observation_id).filter((id): id is string => Boolean(id)),
    ),
    supabase.from('shipping_packaging_profiles').select('*').eq('tenant_id', tenantId),
  ]);

  const profilesById = new Map(((profileRows as ShippingPackagingProfileRow[] | null) ?? []).map((p) => [p.id, p]));
  const matrix = campaign.scenario_matrix as ShippingScenarioMatrix;

  const coverage = computeCampaignCoverage({
    tenantId,
    items: itemsResult.rows,
    observationsById,
    profilesById,
    destinations: matrix.destinations ?? [],
    freshnessWindowDays: matrix.freshnessWindowDays ?? DEFAULT_FRESHNESS_WINDOW_DAYS,
  });

  return { ...coverage, items: itemsResult.rows, itemsTruncated: itemsResult.truncated };
}
