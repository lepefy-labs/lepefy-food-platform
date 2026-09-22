import type { createServiceClient } from '@/lib/supabase/server';
import type {
  ShippingPackagingProfileRow,
  ShippingScenarioMatrix,
  ShippingSimulationCampaignItemRow,
  ShippingSimulationCampaignRow,
} from '@lepefy/types';
import type { Tenant } from '@lepefy/types';
import { findReusableObservation } from './equivalence';
import { quoteScenarioAndPersist } from './quoteScenario';
import { buildScenarioRequest } from './requestIdentity';

type ServiceClient = ReturnType<typeof createServiceClient>;

const DEFAULT_ITEMS_PER_TICK = 8;
const WORKER_COUNT = 2;
const DEFAULT_FRESHNESS_WINDOW_DAYS = 30;
const STALE_RUNNING_ITEM_MS = 10 * 60 * 1000;

/**
 * Traite un lot borné d'éléments de campagne "pending" pour le tenant, en
 * réutilisant le motif éprouvé de shippingSyncBatch.ts (2 workers bornés
 * puisant dans une file partagée). Appelé par un tick cron
 * (/api/internal/shipping-campaign-worker, toujours avec le lot par défaut
 * — 8, conservateur car non supervisé) ou par le déclenchement manuel admin
 * "Traiter maintenant" (/api/admin/shipping-simulation-campaigns/:id/process,
 * qui peut passer un lot plus large : un admin qui clique et attend peut
 * absorber un tick plus long, contrairement au cron silencieux). Chaque
 * campagne reste reprenable quel que soit le déclencheur.
 */
export async function runCampaignBatch(
  supabase: ServiceClient,
  tenant: Tenant,
  options?: { campaignId?: string; itemsPerTick?: number },
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

  const itemsPerTick = Math.min(Math.max(options?.itemsPerTick ?? DEFAULT_ITEMS_PER_TICK, 1), 50);

  const { data: pendingItems } = await supabase
    .from('shipping_simulation_campaign_items')
    .select('*')
    .eq('tenant_id', tenant.id)
    .in('campaign_id', campaignIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(itemsPerTick);

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
      const markItem = (update: Record<string, unknown>) => supabase
        .from('shipping_simulation_campaign_items')
        .update({ ...update, attempted_at: claimTime })
        .eq('id', item.id)
        .eq('tenant_id', tenant.id);

      if (!profile) {
        await markItem({ status: 'failed', error: 'packaging_profile_not_found' });
        failed++;
        continue;
      }

      const campaign = campaignsById.get(item.campaign_id);
      const freshnessWindowDays = (campaign?.scenario_matrix as ShippingScenarioMatrix | undefined)?.freshnessWindowDays
        ?? DEFAULT_FRESHNESS_WINDOW_DAYS;

      try {
        // Identité effective de la demande (CAP exact, colis exacts) — jamais
        // la zone, jamais une tolérance de poids/volume. Un réemploi n'est
        // accepté que pour un devis strictement identique encore frais.
        const request = buildScenarioRequest({
          weightKg: item.scenario.weightKg,
          profile,
          destination: item.scenario.destination,
        });
        const reusable = await findReusableObservation(supabase, {
          tenantId: tenant.id,
          request,
          freshnessWindowDays,
        });

        if (reusable) {
          // skipped_duplicate = réemploi VALIDE d'un devis identique : couvre
          // le scénario mais ne compte pas comme nouvel appel Packlink.
          await markItem({ status: 'skipped_duplicate', observation_id: reusable.id, error: null });
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
          await markItem({ status: 'succeeded', observation_id: result.chosenObservationId, error: null });
          succeeded++;
        } else {
          // Y compris no_eligible_service : les offres ont pu être persistées
          // pour l'analyse, mais le scénario n'a pas de devis exploitable.
          await markItem({ status: 'failed', observation_id: null, error: result.error });
          failed++;
        }
      } catch (err) {
        await markItem({ status: 'failed', error: err instanceof Error ? err.message : 'unexpected_error' });
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
      supabase.from('shipping_simulation_campaign_items').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('campaign_id', campaignId).eq('status', 'succeeded'),
      supabase.from('shipping_simulation_campaign_items').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('campaign_id', campaignId).eq('status', 'failed'),
      supabase.from('shipping_simulation_campaign_items').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('campaign_id', campaignId).eq('status', 'skipped_duplicate'),
      supabase.from('shipping_simulation_campaign_items').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('campaign_id', campaignId).in('status', ['pending', 'running']),
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
