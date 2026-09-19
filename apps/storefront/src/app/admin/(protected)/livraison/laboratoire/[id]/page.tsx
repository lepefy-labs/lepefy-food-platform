import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import { LivraisonTabs } from '../../LivraisonTabs';
import type {
  ShippingPackagingProfileRow,
  ShippingQuoteObservationRow,
  ShippingSimulationCampaignItemRow,
  ShippingSimulationCampaignRow,
} from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon', queued: 'En file', running: 'En cours',
  completed: 'Terminée', completed_with_errors: 'Terminée avec erreurs', cancelled: 'Annulée',
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export default async function CampaignDetailPage({ params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();

  const { data: campaign } = await supabase
    .from('shipping_simulation_campaigns')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!campaign) notFound();
  const typedCampaign = campaign as ShippingSimulationCampaignRow;

  const { data: items } = await supabase
    .from('shipping_simulation_campaign_items')
    .select('*')
    .eq('campaign_id', params.id)
    .limit(1000);
  const typedItems = (items as ShippingSimulationCampaignItemRow[] | null) ?? [];

  const observationIds = typedItems.map((i) => i.observation_id).filter((id): id is string => Boolean(id));
  let observations: ShippingQuoteObservationRow[] = [];
  if (observationIds.length > 0) {
    const { data } = await supabase.from('shipping_quote_observations').select('*').in('id', observationIds);
    observations = (data as ShippingQuoteObservationRow[] | null) ?? [];
  }
  const observationById = new Map(observations.map((o) => [o.id, o]));

  const { data: profileRows } = await supabase.from('shipping_packaging_profiles').select('*').eq('tenant_id', tenant.id);
  const profilesById = new Map((profileRows as ShippingPackagingProfileRow[] | null ?? []).map((p) => [p.id, p.name]));

  const groups = new Map<string, { destination: string; profile: string; costs: number[] }>();
  for (const item of typedItems) {
    const observation = item.observation_id ? observationById.get(item.observation_id) : null;
    if (!observation?.total_provider_cost) continue;
    const destination = `${observation.destination_country} ${observation.destination_postal_code}`;
    const profileName = profilesById.get(item.scenario.packagingProfileId) ?? 'Profil supprimé';
    const key = `${destination}::${profileName}`;
    const existing = groups.get(key);
    if (existing) existing.costs.push(observation.total_provider_cost);
    else groups.set(key, { destination, profile: profileName, costs: [observation.total_provider_cost] });
  }

  const resultRows = Array.from(groups.values()).map((g) => ({
    destination: g.destination,
    profile: g.profile,
    sampleSize: g.costs.length,
    medianCost: parseFloat(median(g.costs).toFixed(2)),
  }));

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Livraison"
        description={`Campagne « ${typedCampaign.name} » — ${STATUS_LABEL[typedCampaign.status] ?? typedCampaign.status}`}
      />

      <LivraisonTabs active="laboratoire" />

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><p className="text-2xs uppercase text-gray-400">Total</p><p className="text-lg font-semibold">{typedCampaign.total_scenarios}</p></div>
          <div><p className="text-2xs uppercase text-gray-400">Réussies</p><p className="text-lg font-semibold text-green-600">{typedCampaign.completed_scenarios - typedCampaign.skipped_scenarios}</p></div>
          <div><p className="text-2xs uppercase text-gray-400">Doublons ignorés</p><p className="text-lg font-semibold">{typedCampaign.skipped_scenarios}</p></div>
          <div><p className="text-2xs uppercase text-gray-400">Échecs</p><p className="text-lg font-semibold text-red-600">{typedCampaign.failed_scenarios}</p></div>
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Coût médian par CAP × profil</h2>
        {resultRows.length === 0 ? (
          <p className="text-sm text-gray-400">Pas encore de résultats — la campagne est peut-être encore en file d&apos;attente (traitement toutes les 5 minutes).</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-3">Destination</th><th className="py-2 pr-3">Profil</th><th className="py-2 pr-3">Coût médian</th><th className="py-2 pr-3">Échantillon</th>
                </tr>
              </thead>
              <tbody>
                {resultRows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-50 dark:border-gray-800/60">
                    <td className="py-2.5 pr-3">{r.destination}</td>
                    <td className="py-2.5 pr-3">{r.profile}</td>
                    <td className="py-2.5 pr-3 font-medium">{r.medianCost.toFixed(2)} €</td>
                    <td className="py-2.5 pr-3 text-gray-400">{r.sampleSize}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
