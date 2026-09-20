import type { createServiceClient } from '@/lib/supabase/server';
import type {
  ShippingCampaignItemScenario,
  ShippingPackagingProfileRow,
  ShippingScenarioMatrix,
  ShippingSimulationCampaignItemRow,
  ShippingSimulationCampaignRow,
} from '@lepefy/types';
import type { Tenant } from '@lepefy/types';
import { findEquivalentObservation } from './equivalence';
import { quoteScenarioAndPersist, INTELLIGENCE_FROM_ADDRESS } from './quoteScenario';

type ServiceClient = ReturnType<typeof createServiceClient>;

const ITEMS_PER_TICK = 8;
const WORKER_COUNT = 2;
const DEFAULT_FRESHNESS_WINDOW_DAYS = 30;
const STALE_RUNNING_ITEM_MS = 10 * 60 * 1000;

/**
 * Traite un lot borné d'éléments de campagne "pending" pour le tenant, en
 * réutilisant le motif éprouvé de shippingSyncBatch.ts (2 workers bornés
 * puisant dans une file partagée). Appelé par un tick cron
 * (/api/internal/shipping-campaign-worker), jamais par une requête HTTP
 * longue — chaque campagne est donc naturellement reprenable.
 */
export async function runCampaignBatch(
  supabase: ServiceClient,
  tenant: Tenant,
  options?: { campaignId?: string },
): Promise<{ processed: number; succeeded: number; failed: number; skipped: number }> {
  if (tenant.shipping_provider !== 'packlink') {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  }
  const resolvedApiKey = tenant.packlink_api_key ?? process.env.PACKLINK_API_KEY;
  if (!resolvedApiKey) return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  const packlinkApiKey: string = resolvedApiKey;

  let activeCampaignQuery = supabase
    .from('shipping_simulation_campaigns')
    .select('*')
    .eq('tenant_id', tenant.id)
    .in('status', ['queued', 'running']);

  if (options?.campaignId) {
    activeCampaignQuery = activeCampaignQuery.eq('id', options.campaignId);
  }

  const { data: activeCampaigns } = await activeCampaignQuery
    .order('created_at', { ascending: true });

  const campaigns = (activeCampaigns ?? []) as ShippingSimulationCampaignRow[];
  if (campaigns.length === 0) return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };

  const campaignIds = campaigns.map((c) => c.id);

  for (const campaign of campaigns) {
    if (campaign.status === 'queued') {
      await supabase.from('shipping_simulation_campaigns')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', campaign.id)
        .eq('tenant_id', tenant.id)
        .eq('status', 'queued');
    }
  }

  // Un tick interrompu après le claim ne doit pas bloquer une campagne pour
  // toujours. Le timeout Vercel est de 60 s ; 10 minutes laisse une marge
  // généreuse avant de rendre un item "running" à nouveau disponible.
  const staleBefore = new Date(Date.now() - STALE_RUNNING_ITEM_MS).toISOString();
  await supabase
    .from('shipping_simulation_campaign_items')
    .update({ status: 'pending' })
    .eq('tenant_id', tenant.id)
    .in('campaign_id', campaignIds)
    .eq('status', 'running')
    .lt('attempted_at', staleBefore);

  const { data: pendingItems } = await supabase
    .from('shipping_simulation_campaign_items')
    .select('*')
    .in('campaign_id', campaignIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(ITEMS_PER_TICK);

  const items = (pendingItems ?? []) as ShippingSimulationCampaignItemRow[];

  const { data: profileRows } = await supabase
    .from('shipping_packaging_profiles')
    .select('*')
    .eq('tenant_id', tenant.id);
  const profilesById = new Map((profileRows as ShippingPackagingProfileRow[] | null ?? []).map((p) => [p.id, p]));

  const campaignsById = new Map(campaigns.map((c) => [c.id, c]));

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const touchedCampaignIds = new Set<string>();

  let index = 0;
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      if (!item) break;

      // Claim CAS: cron et déclenchement admin peuvent se chevaucher sans
      // traiter deux fois le même scénario.
      const claimTime = new Date().toISOString();
      const { data: claimedItem } = await supabase
        .from('shipping_simulation_campaign_items')
        .update({ status: 'running', attempted_at: claimTime })
        .eq('id', item.id)
        .eq('tenant_id', tenant.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (!claimedItem) continue;

      processed++;
      touchedCampaignIds.add(item.campaign_id);
      const profile = profilesById.get(item.scenario.packagingProfileId);
      if (!profile) {
        await supabase.from('shipping_simulation_campaign_items')
          .update({ status: 'failed', error: 'packaging_profile_not_found', attempted_at: claimTime })
          .eq('id', item.id);
        failed++;
        continue;
      }

      const campaign = campaignsById.get(item.campaign_id);
      const freshnessWindowDays = (campaign?.scenario_matrix as ShippingScenarioMatrix | undefined)?.freshnessWindowDays
        ?? DEFAULT_FRESHNESS_WINDOW_DAYS;

      const totalWeightG = Math.round(item.scenario.weightKg * 1000);
      const volumeCm3 = profile.box_length_cm * profile.box_width_cm * profile.box_height_cm;

      try {
        const equivalent = await findEquivalentObservation(supabase, {
          tenantId: tenant.id,
          provider: 'packlink',
          originCountry: INTELLIGENCE_FROM_ADDRESS.country,
          originPostalCode: INTELLIGENCE_FROM_ADDRESS.zip_code,
          destinationCountry: item.scenario.destination.country,
          destinationPostalCode: item.scenario.destination.postalCode,
          destinationZoneCode: item.scenario.destination.zoneCode ?? null,
          numParcels: Math.ceil(totalWeightG / profile.max_weight_g),
          totalWeightG,
          volumeCm3,
          freshnessWindowDays,
        });

        if (equivalent) {
          await supabase.from('shipping_simulation_campaign_items')
            .update({ status: 'skipped_duplicate', observation_id: equivalent.id, attempted_at: claimTime })
            .eq('id', item.id);
          skipped++;
          continue;
        }

        const result = await quoteScenarioAndPersist({
          supabase,
          tenantId: tenant.id,
          packlinkApiKey,
          source: 'synthetic_simulation',
          campaignId: item.campaign_id,
          weightKg: item.scenario.weightKg,
          profile,
          destination: item.scenario.destination,
        });

        if (result.ok) {
          await supabase.from('shipping_simulation_campaign_items')
            .update({ status: 'succeeded', observation_id: result.chosenObservationId, attempted_at: claimTime })
            .eq('id', item.id);
          succeeded++;
        } else {
          await supabase.from('shipping_simulation_campaign_items')
            .update({ status: 'failed', error: result.error ?? 'unknown_error', attempted_at: claimTime })
            .eq('id', item.id);
          failed++;
        }
      } catch (err) {
        await supabase.from('shipping_simulation_campaign_items')
          .update({ status: 'failed', error: err instanceof Error ? err.message : 'unexpected_error', attempted_at: claimTime })
          .eq('id', item.id);
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: WORKER_COUNT }, () => worker()));

  for (const campaignId of touchedCampaignIds) {
    // COUNT agrégat (head: true) et non un SELECT de lignes : un select('status')
    // sans .range() est plafonné par PostgREST (1000 lignes par défaut), et les
    // lignes récemment mises à jour (donc physiquement déplacées par MVCC) se
    // retrouvent hors de cet échantillon — un vrai bug observé en production
    // (32 items réellement skipped_duplicate, complétés jamais reflétés côté
    // shipping_simulation_campaigns.completed_scenarios). Les agrégats COUNT
    // ne sont pas concernés par cette limite de lignes retournées.
    const [succeededResult, failedResult, skippedResult, pendingResult] = await Promise.all([
      supabase.from('shipping_simulation_campaign_items').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'succeeded'),
      supabase.from('shipping_simulation_campaign_items').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'failed'),
      supabase.from('shipping_simulation_campaign_items').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'skipped_duplicate'),
      supabase.from('shipping_simulation_campaign_items').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).in('status', ['pending', 'running']),
    ]);
    const succeededCount = succeededResult.count ?? 0;
    const failedCount = failedResult.count ?? 0;
    const skippedCount = skippedResult.count ?? 0;
    const pendingCount = pendingResult.count ?? 0;

    const update: Record<string, unknown> = {
      completed_scenarios: succeededCount + skippedCount,
      failed_scenarios: failedCount,
      skipped_scenarios: skippedCount,
    };

    // Relire l'état évite qu'un lot en vol ne réécrive une annulation admin.
    const { data: currentCampaign } = await supabase
      .from('shipping_simulation_campaigns')
      .select('status')
      .eq('id', campaignId)
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (currentCampaign?.status !== 'cancelled' && pendingCount === 0) {
      update.status = failedCount > 0 ? 'completed_with_errors' : 'completed';
      update.completed_at = new Date().toISOString();
    }

    await supabase.from('shipping_simulation_campaigns')
      .update(update)
      .eq('id', campaignId)
      .eq('tenant_id', tenant.id);
  }

  return { processed, succeeded, failed, skipped };
}
