import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import { LivraisonTabs } from '../LivraisonTabs';
import { buildObservationsSummary } from '@/lib/shipping/intelligence/observationsSummary';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const CONFIDENCE_LABEL: Record<string, string> = { high: 'Élevée', medium: 'Moyenne', low: 'Faible' };
const CONFIDENCE_CLS: Record<string, string> = {
  high: 'bg-green-50 text-green-700', medium: 'bg-amber-50 text-amber-700', low: 'bg-red-50 text-red-700',
};

export default async function AdminShippingHistoryPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const supabase = createServiceClient();
  const summary = await buildObservationsSummary(supabase, tenant.id);

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Livraison"
        description="Coûts fournisseur observés, agrégés par destination et profil d'emballage — jamais un prix client."
        meta={`${summary.scenariosMeasured} scénario${summary.scenariosMeasured !== 1 ? 's' : ''} mesuré${summary.scenariosMeasured !== 1 ? 's' : ''} · ${summary.totalObservations} offre${summary.totalObservations !== 1 ? 's' : ''} provider enregistrée${summary.totalObservations !== 1 ? 's' : ''}`}
      />

      <LivraisonTabs active="historique" />

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <p className="text-xs text-gray-400 mb-3">
          Un échantillon = un scénario mesuré (CAP × poids × colis), valorisé par le service éligible au coût base + taxes le plus bas de son devis le plus récent. Ce sont des devis Packlink hors TVA (Packlink ne renvoie pas de taxe ; le checkout ajoute la TVA du pays), pas des factures.
          {summary.truncated && <> Volume maximal lu atteint : agrégats partiels.</>}
        </p>
        {summary.groups.length === 0 ? (
          <p className="text-sm text-gray-400">
            Aucune observation encore — utilisez le laboratoire (test rapide ou campagne) pour commencer à construire l&apos;historique.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs font-medium text-gray-400 uppercase tracking-wide border-b border-gray-100 dark:border-gray-800">
                  <th className="py-2 pr-3">Destination</th><th className="py-2 pr-3">Profil</th><th className="py-2 pr-3" title="Devis Packlink hors TVA (Packlink ne renvoie pas de taxe ; le checkout ajoute la TVA du pays)">Coût médian HT</th>
                  <th className="py-2 pr-3">Plage HT</th><th className="py-2 pr-3" title="Scénarios distincts mesurés (dernier devis valide de chacun) — les offres alternatives d'un même devis ne comptent pas">Scénarios</th><th className="py-2 pr-3">CAP</th><th className="py-2 pr-3">Confiance</th><th className="py-2 pr-3">Dernière observation</th>
                </tr>
              </thead>
              <tbody>
                {summary.groups.map((g, i) => (
                  <tr key={i} className="border-b border-gray-50 dark:border-gray-800/60">
                    <td className="py-2.5 pr-3">{g.destination}</td>
                    <td className="py-2.5 pr-3">{g.packagingProfile}</td>
                    <td className="py-2.5 pr-3 font-medium">{g.medianCost.toFixed(2)} €</td>
                    <td className="py-2.5 pr-3 text-gray-500">{g.minCost.toFixed(2)}–{g.maxCost.toFixed(2)} €</td>
                    <td className="py-2.5 pr-3 text-gray-400">{g.sampleSize}</td>
                    <td className="py-2.5 pr-3 text-gray-400">{g.postalCodes}</td>
                    <td className="py-2.5 pr-3"><span className={`text-2xs font-semibold px-1.5 py-0.5 rounded ${CONFIDENCE_CLS[g.confidence]}`}>{CONFIDENCE_LABEL[g.confidence]}</span></td>
                    <td className="py-2.5 pr-3 text-gray-400">{new Date(g.mostRecentObservedAt).toLocaleDateString('fr-FR')}</td>
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
