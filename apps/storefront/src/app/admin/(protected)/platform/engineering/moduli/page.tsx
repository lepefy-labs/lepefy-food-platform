import Link from 'next/link';
import { formatNumber } from '@/lib/admin/format';
import { getActiveRun } from '@/lib/engineering/server/activeRun';
import { loadDocuments, loadFiles, loadModules } from '@/lib/engineering/server/repository';
import { moduleDocStatus, summarizeModule } from '@/lib/engineering/explorer';
import Badge from '../../../../_components/ui/Badge';
import { ErrorState } from '../../../../_components/ui/States';
import { ENGINEERING_PATH, EngineeringChrome, IndexBanner, IndexGate } from '../_components/EngineeringChrome';
import { docStatusTone } from '../_components/tones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function EngineeringModulesPage() {
  const gate = IndexGate({ result: await getActiveRun() });
  if (!gate.run) return <EngineeringChrome active="moduli" title="Moduli">{gate.fallback}</EngineeringChrome>;
  const run = gate.run;

  try {
    const [files, documents, modules] = await Promise.all([loadFiles(run.runId), loadDocuments(run.runId), loadModules(run.runId)]);
    return (
      <EngineeringChrome active="moduli" title="Moduli" description="Ogni modulo raggruppa i file per percorso (registro versionato nel codice). «Documentato» significa un documento verificato da una persona, non la sola presenza nel registro.">
        <IndexBanner run={run} />
        <div className="overflow-x-auto rounded-[10px] border border-a-border bg-a-surface">
          <table className="w-full border-separate border-spacing-0 text-sm text-a-text">
            <caption className="sr-only">Moduli del repository</caption>
            <thead>
              <tr>{['Modulo', 'Categoria', 'File', 'API', 'Pagine', 'Test', 'Migration', 'Documentazione'].map((header, index) => (
                <th key={header} scope="col" className={`border-b border-a-border bg-a-surface-2 px-3 py-2 text-xs font-semibold text-a-text-2 ${index >= 2 && index <= 6 ? 'text-right' : 'text-left'}`}>{header}</th>
              ))}</tr>
            </thead>
            <tbody>
              {modules.map((entry) => {
                const stats = summarizeModule(entry.moduleKey, files, documents);
                const status = moduleDocStatus(stats.documents);
                const number = 'border-b border-a-border px-3 py-2.5 text-right tabular-nums text-a-text-2';
                return (
                  <tr key={entry.moduleKey}>
                    <td className="border-b border-a-border px-3 py-2.5 font-semibold"><Link href={`${ENGINEERING_PATH}/moduli/${entry.moduleKey}`} className="hover:underline">{entry.title}</Link></td>
                    <td className="border-b border-a-border px-3 py-2.5 text-a-text-2">{entry.category}</td>
                    <td className={number}>{formatNumber(stats.files)}</td>
                    <td className={number}>{stats.apiRoutes}</td>
                    <td className={number}>{stats.pages}</td>
                    <td className={number}>{stats.tests}</td>
                    <td className={number}>{stats.migrations}</td>
                    <td className="border-b border-a-border px-3 py-2.5"><Badge tone={docStatusTone(status.status)} dot>{status.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </EngineeringChrome>
    );
  } catch (error) {
    console.error('[platform/engineering] modules failed:', (error as { code?: string })?.code ?? 'unknown');
    return <EngineeringChrome active="moduli" title="Moduli"><ErrorState title="Lettura dell’indice non riuscita" supportHint={false} /></EngineeringChrome>;
  }
}
