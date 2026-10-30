import Link from 'next/link';
import { IconBinaryTree, IconBook2, IconCode, IconFileOff, IconPackages } from '@tabler/icons-react';
import { formatNumber } from '@/lib/admin/format';
import { getActiveRun } from '@/lib/engineering/server/activeRun';
import { loadDocuments, loadExcludedSummary, loadFiles, loadModules } from '@/lib/engineering/server/repository';
import { moduleDocStatus, summarizeModule } from '@/lib/engineering/explorer';
import { DOC_REVIEW_LABELS_IT } from '@/lib/engineering/domain';
import AdminStatCard from '../../../_components/ui/AdminStatCard';
import Badge from '../../../_components/ui/Badge';
import { ErrorState } from '../../../_components/ui/States';
import { ENGINEERING_PATH, EngineeringChrome, IndexBanner, IndexGate, SearchForm } from './_components/EngineeringChrome';
import { docStatusTone } from './_components/tones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Access (Platform Owner only) is enforced by platform/layout.tsx; the Hub APIs call requireEngineeringApi.
export default async function EngineeringOverviewPage() {
  const gate = IndexGate({ result: await getActiveRun() });
  if (!gate.run) {
    return <EngineeringChrome active="panoramica" title="Engineering Hub" description="Portale tecnico-funzionale interno per il team IT.">{gate.fallback}</EngineeringChrome>;
  }
  const run = gate.run;

  let data: { files: Awaited<ReturnType<typeof loadFiles>>; documents: Awaited<ReturnType<typeof loadDocuments>>; modules: Awaited<ReturnType<typeof loadModules>>; excluded: Awaited<ReturnType<typeof loadExcludedSummary>> } | null = null;
  try {
    const [files, documents, modules, excluded] = await Promise.all([loadFiles(run.runId), loadDocuments(run.runId), loadModules(run.runId), loadExcludedSummary(run.runId)]);
    data = { files, documents, modules, excluded };
  } catch (error) {
    console.error('[platform/engineering] overview failed:', (error as { code?: string })?.code ?? 'unknown');
  }
  if (!data) {
    return <EngineeringChrome active="panoramica" title="Engineering Hub"><ErrorState title="Lettura dell’indice non riuscita" supportHint={false} /></EngineeringChrome>;
  }

  const { files, documents, modules, excluded } = data;
  const withModule = files.filter((file) => file.moduleKey).length;
  const documented = modules.filter((entry) => moduleDocStatus(documents.filter((doc) => doc.moduleKey === entry.moduleKey)).status === 'verified').length;

  return (
    <EngineeringChrome active="panoramica" title="Engineering Hub" description="Indice tecnico del repository: file, simboli, relazioni dimostrate e documenti, sempre riferiti a un commit.">
      <IndexBanner run={run} />
      <SearchForm modules={modules} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminStatCard title="File indicizzati" value={formatNumber(run.counts.files ?? 0)} description={`${formatNumber(withModule)} assegnati a un modulo`} tone="neutral" icon={IconCode} href={`${ENGINEERING_PATH}/codice`} />
        <AdminStatCard title="Moduli" value={modules.length} description={`${documented} con documento verificato`} tone="info" icon={IconPackages} href={`${ENGINEERING_PATH}/moduli`} />
        <AdminStatCard title="Relazioni dimostrate" value={formatNumber(run.counts.relations ?? 0)} description="ognuna con file e riga di prova" tone="neutral" icon={IconBinaryTree} href={`${ENGINEERING_PATH}/architettura`} />
        <AdminStatCard title="Documenti tecnici" value={formatNumber(run.counts.documents ?? 0)} description={`${formatNumber(run.counts.chunks ?? 0)} sezioni ricercabili`} tone="neutral" icon={IconBook2} />
      </div>

      <section aria-labelledby="eng-modules" className="space-y-3">
        <h2 id="eng-modules" className="text-base font-semibold text-a-text">Moduli</h2>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((entry) => {
            const stats = summarizeModule(entry.moduleKey, files, documents);
            const status = moduleDocStatus(stats.documents);
            return (
              <li key={entry.moduleKey} className="rounded-[10px] border border-a-border bg-a-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`${ENGINEERING_PATH}/moduli/${entry.moduleKey}`} className="font-semibold text-a-text hover:underline">{entry.title}</Link>
                  <Badge tone={docStatusTone(status.status)} dot>{status.label}</Badge>
                </div>
                <p className="mt-1 text-sm text-a-text-2">{entry.summary}</p>
                <p className="mt-2 text-xs text-a-text-3">{formatNumber(stats.files)} file · {stats.apiRoutes} API · {stats.pages} pagine · {stats.tests} test · {stats.migrations} migration</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="eng-excluded" className="space-y-2 rounded-[10px] border border-a-border bg-a-surface p-4">
        <h2 id="eng-excluded" className="flex items-center gap-2 text-base font-semibold text-a-text"><IconFileOff size={18} aria-hidden="true" />File esclusi dall’indice</h2>
        <p className="text-sm text-a-text-2">
          {formatNumber(run.counts.excluded ?? 0)} file non sono indicizzati: segreti, dati personali, binari, dump e file generati vengono esclusi per intero. Di essi si conserva solo percorso e regola, mai il valore.
        </p>
        {excluded.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {excluded.map((entry) => <li key={entry.reason}><Badge tone="neutral">{entry.reason} · {formatNumber(entry.count)}</Badge></li>)}
          </ul>
        )}
      </section>

      <p className="text-xs text-a-text-3">
        Stati dei documenti: {Object.values(DOC_REVIEW_LABELS_IT).join(' · ')}. «Verificata» richiede una revisione umana legata a uno SHA.
      </p>
    </EngineeringChrome>
  );
}
