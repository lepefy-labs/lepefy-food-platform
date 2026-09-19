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
): Promise<{ processed: number; succeeded: number; failed: number; skipped: number }> {
  if (tenant.shipping_provider !== 'packlink') {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  }
  const resolvedApiKey = tenant.packlink_api_key ?? process.env.PACKLINK_API_KEY;
  if (!resolvedApiKey) return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  const packlinkApiKey: string = resolvedApiKey;

  const { data: activeCampaigns } = await supabase
    .from('shipping_simulation_campaigns')
    .select('*')
    .eq('tenant_id', tenant.id)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: true });

  const campaigns = (activeCampaigns ?? []) as ShippingSimulationCampaignRow[];
  if (campaigns.length === 0) return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };

  const campaignIds = campaigns.map((c) => c.id);

  for (const campaign of campaigns) {
    if (campaign.status === 'queued') {
      await supabase.from('shipping_simulation_campaigns')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', campaign.id);
    }
  }

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

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const touchedCampaignIds = new Set<string>();

  let index = 0;
  async function worker() {
    while (index < items.length) {
      const item = items[index++];
      if (!item) break;
      touchedCampaignIds.add(item.campaign_id);
      const profile = profilesById.get(item.scenario.packagingProfileId);
      if (!profile) {
        await supabase.from('shipping_simulation_campaign_items')
          .update({ status: 'failed', error: 'packaging_profile_not_found', attempted_at: new Date().toISOString() })
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
            .update({ status: 'skipped_duplicate', observation_id: equivalent.id, attempted_at: new Date().toISOString() })
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
            .update({ status: 'succeeded', observation_id: result.chosenObservationId, attempted_at: new Date().toISOString() })
            .eq('id', item.id);
          succeeded++;
        } else {
          await supabase.from('shipping_simulation_campaign_items')
            .update({ status: 'failed', error: result.error ?? 'unknown_error', attempted_at: new Date().toISOString() })
            .eq('id', item.id);
          failed++;
        }
      } catch (err) {
        await supabase.from('shipping_simulation_campaign_items')
          .update({ status: 'failed', error: err instanceof Error ? err.message : 'unexpected_error', attempted_at: new Date().toISOString() })
          .eq('id', item.id);
        failed++;
      }
    }
  }

  await Promise.all(Array.from({ length: WORKER_COUNT }, () => worker()));

  for (const campaignId of touchedCampaignIds) {
    const { data: counts } = await supabase
      .from('shipping_simulation_campaign_items')
      .select('status')
      .eq('campaign_id', campaignId);
    const rows = (counts ?? []) as { status: string }[];
    const succeededCount = rows.filter((r) => r.status === 'succeeded').length;
    const failedCount = rows.filter((r) => r.status === 'failed').length;
    const skippedCount = rows.filter((r) => r.status === 'skipped_duplicate').length;
    const pendingCount = rows.filter((r) => r.status === 'pending' || r.status === 'running').length;

    const update: Record<string, unknown> = {
      completed_scenarios: succeededCount + skippedCount,
      failed_scenarios: failedCount,
      skipped_scenarios: skippedCount,
    };
    if (pendingCount === 0) {
      update.status = failedCount > 0 ? 'completed_with_errors' : 'completed';
      update.completed_at = new Date().toISOString();
    }
    await supabase.from('shipping_simulation_campaigns').update(update).eq('id', campaignId);
  }

  return { processed: items.length, succeeded, failed, skipped };
}
