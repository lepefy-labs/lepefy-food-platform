import Link from 'next/link';
import { formatNumber } from '@/lib/admin/format';
import { getActiveRun } from '@/lib/engineering/server/activeRun';
import { loadFiles, loadImportEdges, loadModules } from '@/lib/engineering/server/repository';
import { moduleDependencies, topLevelAreas } from '@/lib/engineering/explorer';
import { ErrorState } from '../../../../_components/ui/States';
import { ENGINEERING_PATH, EngineeringChrome, IndexBanner, IndexGate } from '../_components/EngineeringChrome';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function EngineeringArchitecturePage() {
  const gate = IndexGate({ result: await getActiveRun() });
  if (!gate.run) return <EngineeringChrome active="architettura" title="Architettura">{gate.fallback}</EngineeringChrome>;
  const run = gate.run;

  try {
    const [files, modules, imports] = await Promise.all([loadFiles(run.runId), loadModules(run.runId), loadImportEdges(run.runId)]);
    const areas = topLevelAreas(files);
    const dependencies = moduleDependencies(imports.edges, new Map(files.map((file) => [file.id, file])));
    const titleOf = (key: string) => modules.find((entry) => entry.moduleKey === key)?.title ?? key;

    return (
      <EngineeringChrome active="architettura" title="Architettura" description="Struttura del repository e dipendenze fra moduli. Ogni dipendenza è un conteggio di import letterali fra file indicizzati: nessun legame è dedotto dai nomi.">
        <IndexBanner run={run} />

        <section aria-labelledby="arch-areas" className="space-y-2">
          <h2 id="arch-areas" className="text-base font-semibold text-a-text">Aree del repository</h2>
          <div className="overflow-x-auto rounded-[10px] border border-a-border bg-a-surface">
            <table className="w-full border-separate border-spacing-0 text-sm text-a-text">
              <caption className="sr-only">File per area del repository</caption>
              <thead><tr>
                <th scope="col" className="border-b border-a-border bg-a-surface-2 px-3 py-2 text-left text-xs font-semibold text-a-text-2">Area</th>
                <th scope="col" className="border-b border-a-border bg-a-surface-2 px-3 py-2 text-right text-xs font-semibold text-a-text-2">File</th>
                <th scope="col" className="border-b border-a-border bg-a-surface-2 px-3 py-2 text-right text-xs font-semibold text-a-text-2">Righe</th>
              </tr></thead>
              <tbody>
                {areas.map((area) => (
                  <tr key={area.path}>
                    <td className="border-b border-a-border px-3 py-2.5 font-mono text-xs"><Link href={`${ENGINEERING_PATH}/codice?dir=${encodeURIComponent(area.path)}`} className="hover:underline">{area.path}</Link></td>
                    <td className="border-b border-a-border px-3 py-2.5 text-right tabular-nums text-a-text-2">{formatNumber(area.files)}</td>
                    <td className="border-b border-a-border px-3 py-2.5 text-right tabular-nums text-a-text-2">{formatNumber(area.lines)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="arch-deps" className="space-y-2">
          <h2 id="arch-deps" className="text-base font-semibold text-a-text">Dipendenze fra moduli</h2>
          {dependencies.length === 0 ? (
            <p className="text-sm text-a-text-3">Nessun import fra moduli diversi nell’indice attuale.</p>
          ) : (
            <div className="overflow-x-auto rounded-[10px] border border-a-border bg-a-surface">
              <table className="w-full border-separate border-spacing-0 text-sm text-a-text">
                <caption className="sr-only">Import fra moduli</caption>
                <thead><tr>
                  <th scope="col" className="border-b border-a-border bg-a-surface-2 px-3 py-2 text-left text-xs font-semibold text-a-text-2">Modulo</th>
                  <th scope="col" className="border-b border-a-border bg-a-surface-2 px-3 py-2 text-left text-xs font-semibold text-a-text-2">Importa da</th>
                  <th scope="col" className="border-b border-a-border bg-a-surface-2 px-3 py-2 text-right text-xs font-semibold text-a-text-2">Import</th>
                </tr></thead>
                <tbody>
                  {dependencies.slice(0, 80).map((entry) => (
                    <tr key={`${entry.from}>${entry.to}`}>
                      <td className="border-b border-a-border px-3 py-2.5 font-semibold"><Link href={`${ENGINEERING_PATH}/moduli/${entry.from}`} className="hover:underline">{titleOf(entry.from)}</Link></td>
                      <td className="border-b border-a-border px-3 py-2.5"><Link href={`${ENGINEERING_PATH}/moduli/${entry.to}`} className="hover:underline">{titleOf(entry.to)}</Link></td>
                      <td className="border-b border-a-border px-3 py-2.5 text-right tabular-nums text-a-text-2">{entry.imports}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-a-text-3">
            Solo import fra file dei moduli registrati; i file senza modulo non compaiono. {imports.truncated ? 'Elenco parziale: raggiunto il limite di righe lette.' : ''}
          </p>
        </section>
      </EngineeringChrome>
    );
  } catch (error) {
    console.error('[platform/engineering] architecture failed:', (error as { code?: string })?.code ?? 'unknown');
    return <EngineeringChrome active="architettura" title="Architettura"><ErrorState title="Lettura dell’indice non riuscita" supportHint={false} /></EngineeringChrome>;
  }
}
