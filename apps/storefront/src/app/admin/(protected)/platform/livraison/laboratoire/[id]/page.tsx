import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { loadCampaignCoverage } from '@/lib/shipping/intelligence/campaignData';
import { CampaignCoverageTable } from './CampaignCoverageTable';
import { ResampleCampaignButton } from './ResampleCampaignButton';
import { CampaignErrorDiagnostic } from './CampaignErrorDiagnostic';
import type { ShippingScenarioMatrix, ShippingSimulationCampaignRow } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Brouillon', queued: 'En file', running: 'En cours',
  completed: 'Terminée', completed_with_errors: 'Terminée avec erreurs', cancelled: 'Annulée',
};
const MODE_LABEL: Record<string, string> = {
  initial: 'Couverture initiale', deep: 'Analyse approfondie', manual: 'Poids manuels', resample: 'Remesure',
};

function Stat({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'green' | 'red' | 'amber' }) {
  const toneCls = tone === 'green' ? 'text-tone-success-fg' : tone === 'red' ? 'text-tone-danger-fg' : tone === 'amber' ? 'text-tone-warning-fg' : 'text-a-text';
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-a-text-3">{label}</p>
      <p className={`text-lg font-semibold ${toneCls}`}>{value}</p>
      {hint && <p className="text-xs text-a-text-3">{hint}</p>}
    </div>
  );
}

export default async function CampaignDetailPage({ params }: { params: { id: string } }) {
  if (await requirePlatformOwner()) redirect('/admin');
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
  const matrix = typedCampaign.scenario_matrix as ShippingScenarioMatrix;

  // Items paginés (≤ 2000, jamais tronqués à 1000) + observations relues par
  // lots, filtrées par tenant — voir campaignData.ts.
  const coverage = await loadCampaignCoverage(supabase, tenant.id, typedCampaign);
  const { summary } = coverage;
  const campaignActive = typedCampaign.status === 'queued' || typedCampaign.status === 'running';

  return (
    <div>
      <div className="mb-5">
        <Link href="/admin/platform/livraison/laboratoire" className="text-xs font-medium text-a-text-3 hover:underline">← Laboratoire</Link>
        <h2 className="mt-1 text-lg font-semibold text-a-text">Campagne « {typedCampaign.name} »</h2>
        <p className="text-sm text-a-text-3">
          {STATUS_LABEL[typedCampaign.status] ?? typedCampaign.status}{matrix.samplingMode ? ` · ${MODE_LABEL[matrix.samplingMode] ?? matrix.samplingMode}` : ''}
        </p>
      </div>

      <section className="bg-a-surface rounded-xl border border-a-border p-5 mb-6">
        <h2 className="text-sm font-semibold text-a-text mb-3">Vue d&apos;ensemble</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Stat label="CAP prévus" value={summary.plannedPostalCodes} hint={`${summary.plannedScenarios} scénarios`} />
          <Stat label="CAP complets" value={`${summary.completePostalCodes}/${summary.plannedPostalCodes}`} tone="green" hint="tous les scénarios couverts" />
          <Stat label="Nouveaux devis" value={summary.newQuotes} hint="appels Packlink effectifs" />
          <Stat label="Réemplois valides" value={summary.validReuses} hint="devis identique et frais" />
          <Stat label="Sans devis" value={summary.failed + summary.rejected} tone={summary.failed + summary.rejected > 0 ? 'red' : undefined} hint={summary.rejected > 0 ? `dont ${summary.rejected} refusé(s) par Packlink` : 'échecs'} />
          <Stat label="À traiter" value={summary.remaining} hint={summary.running > 0 ? `${summary.running} en cours` : undefined} />
        </div>

        <div className="mt-5 border-t border-a-border pt-4">
          <h3 className="text-xs font-semibold text-a-text mb-1">Diagnostic des erreurs</h3>
          <p className="text-xs text-a-text-3 mb-2">
            Scénarios sans devis valide, par motif — à examiner avant toute remesure. Les données d&apos;origine ne sont ni supprimées ni modifiées.
          </p>
          <CampaignErrorDiagnostic breakdown={summary.errorBreakdown} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ResampleCampaignButton
            campaignId={typedCampaign.id}
            candidates={summary.resampleCandidates}
            breakdown={summary.errorBreakdown}
            disabled={campaignActive}
          />
          {campaignActive && summary.resampleCandidates > 0 && (
            <p className="text-xs text-a-text-3">Remesure disponible une fois la campagne terminée ou annulée.</p>
          )}
        </div>
        {coverage.itemsTruncated && (
          <p className="mt-3 text-xs text-tone-danger-fg">Nombre d&apos;items inattendu : la couverture affichée est partielle.</p>
        )}
      </section>

      <section className="bg-a-surface rounded-xl border border-a-border p-5">
        <h2 className="text-sm font-semibold text-a-text mb-1">Couverture par CAP</h2>
        <p className="text-xs text-a-text-3 mb-3">
          Un CAP est couvert uniquement par un devis valide de ce CAP et de cette configuration de colis. Les coûts sont des devis Packlink (base + taxes du service éligible le moins cher), pas des factures.
        </p>
        <CampaignCoverageTable rows={coverage.rows} postalCodes={coverage.postalCodes} />
      </section>
    </div>
  );
}
