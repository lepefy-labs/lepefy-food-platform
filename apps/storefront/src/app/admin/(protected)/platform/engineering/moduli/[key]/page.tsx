import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatNumber } from '@/lib/admin/format';
import { FILE_KINDS, DOC_REVIEW_LABELS_IT, githubLink } from '@/lib/engineering/domain';
import { getActiveRun } from '@/lib/engineering/server/activeRun';
import { loadDocuments, loadFiles, loadImportEdges, loadModuleReferences, loadModules } from '@/lib/engineering/server/repository';
import { docNeedsRecheck, moduleDependencies, moduleDocStatus, summarizeModule } from '@/lib/engineering/explorer';
import Badge from '../../../../../_components/ui/Badge';
import { EmptyState, ErrorState } from '../../../../../_components/ui/States';
import { ENGINEERING_PATH, EngineeringChrome, IndexBanner, IndexGate } from '../../_components/EngineeringChrome';
import { docStatusTone } from '../../_components/tones';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const KIND_LABELS: Record<string, string> = {
  source: 'Sorgenti', test: 'Test', api_route: 'Route API', page: 'Pagine', component: 'Componenti', migration: 'Migration',
  sql: 'SQL', doc: 'Documenti', config: 'Configurazione', ci: 'CI', script: 'Script', other: 'Altro',
};
const REF_TITLES = { uses_table: 'Tabelle usate', calls_rpc: 'RPC chiamate', calls_api: 'API chiamate dal client', defines_object: 'Oggetti SQL definiti' } as const;

export default async function EngineeringModulePage({ params }: { params: { key: string } }) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(params.key)) notFound();
  const gate = IndexGate({ result: await getActiveRun() });
  if (!gate.run) return <EngineeringChrome active="moduli" title="Modulo">{gate.fallback}</EngineeringChrome>;
  const run = gate.run;

  try {
    const [files, documents, modules, imports] = await Promise.all([loadFiles(run.runId), loadDocuments(run.runId), loadModules(run.runId), loadImportEdges(run.runId)]);
    const current = modules.find((candidate) => candidate.moduleKey === params.key);
    if (!current) notFound();

    const stats = summarizeModule(current.moduleKey, files, documents);
    const status = moduleDocStatus(stats.documents);
    const ownFiles = files.filter((file) => file.moduleKey === current.moduleKey);
    const references = await loadModuleReferences(run.runId, ownFiles.map((file) => file.id));
    const dependencies = moduleDependencies(imports.edges, new Map(files.map((file) => [file.id, file])));
    const uses = dependencies.filter((link) => link.from === current.moduleKey);
    const usedBy = dependencies.filter((link) => link.to === current.moduleKey);
    const titleOf = (key: string) => modules.find((entry) => entry.moduleKey === key)?.title ?? key;
    const keyFiles = ownFiles.filter((file) => ['api_route', 'page'].includes(file.kind)).slice(0, 40);

    return (
      <EngineeringChrome active="moduli" title={current.title} description={current.summary} breadcrumb={[{ label: 'Moduli', href: `${ENGINEERING_PATH}/moduli` }, { label: current.title }]}>
        <IndexBanner run={run} />
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={docStatusTone(status.status)} dot>{status.label}</Badge>
          <Badge tone="neutral">{current.category}</Badge>
          <span className="text-sm text-a-text-2">{formatNumber(stats.files)} file · {formatNumber(stats.lines)} righe</span>
        </div>

        <section aria-labelledby="mod-kinds" className="space-y-2">
          <h2 id="mod-kinds" className="text-base font-semibold text-a-text">Composizione</h2>
          <ul className="flex flex-wrap gap-2">
            {FILE_KINDS.filter((kind) => stats.byKind[kind]).map((kind) => <li key={kind}><Badge tone="neutral">{KIND_LABELS[kind]} · {formatNumber(stats.byKind[kind] ?? 0)}</Badge></li>)}
          </ul>
        </section>

        <section aria-labelledby="mod-docs" className="space-y-2">
          <h2 id="mod-docs" className="text-base font-semibold text-a-text">Documenti</h2>
          {stats.documents.length === 0 ? (
            <EmptyState title="Nessun documento tecnico per questo modulo" description="Un modulo senza documento resta «Nessun documento»: il registro non basta a dichiararlo documentato." />
          ) : (
            <ul className="divide-y divide-a-border rounded-[10px] border border-a-border bg-a-surface">
              {stats.documents.map((doc) => (
                <li key={doc.docKey} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <Link href={`${ENGINEERING_PATH}/codice?path=${encodeURIComponent(doc.path)}`} className="font-semibold text-a-text hover:underline">{doc.title}</Link>
                  <span className="flex items-center gap-2">
                    {docNeedsRecheck(doc, run.commitSha) && <Badge tone="warning">Da rileggere sul commit attuale</Badge>}
                    <Badge tone={docStatusTone(doc.reviewStatus)} dot>{DOC_REVIEW_LABELS_IT[doc.reviewStatus]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="mod-entry" className="space-y-2">
          <h2 id="mod-entry" className="text-base font-semibold text-a-text">Punti di ingresso (API e pagine)</h2>
          {keyFiles.length === 0 ? <p className="text-sm text-a-text-3">Nessuna route o pagina assegnata a questo modulo.</p> : (
            <ul className="grid gap-1 text-sm md:grid-cols-2">
              {keyFiles.map((file) => (
                <li key={file.id} className="truncate"><Link href={`${ENGINEERING_PATH}/codice?path=${encodeURIComponent(file.path)}`} className="font-mono text-xs text-a-text-2 hover:underline">{file.path.replace('apps/storefront/src/', '')}</Link></li>
              ))}
            </ul>
          )}
          {stats.apiRoutes + stats.pages > keyFiles.length && <p className="text-xs text-a-text-3">Mostrati {keyFiles.length} di {stats.apiRoutes + stats.pages}. Usa Codice o la ricerca per il resto.</p>}
        </section>

        {(Object.keys(REF_TITLES) as Array<keyof typeof REF_TITLES>).map((kind) => {
          const rows = references.filter((reference) => reference.kind === kind).slice(0, 30);
          if (rows.length === 0) return null;
          return (
            <section key={kind} aria-label={REF_TITLES[kind]} className="space-y-2">
              <h2 className="text-base font-semibold text-a-text">{REF_TITLES[kind]}</h2>
              <ul className="flex flex-wrap gap-2">
                {rows.map((row) => (
                  <li key={row.targetRef}>
                    <Link href={`${ENGINEERING_PATH}/ricerca?q=${encodeURIComponent(row.targetRef)}`}><Badge tone="neutral">{row.targetRef} · {row.files}</Badge></Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section aria-labelledby="mod-deps" className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <h2 id="mod-deps" className="text-base font-semibold text-a-text">Importa da</h2>
            {uses.length === 0 ? <p className="text-sm text-a-text-3">Nessun import verso altri moduli.</p> : (
              <ul className="space-y-1 text-sm">{uses.map((entry) => <li key={entry.to}><Link href={`${ENGINEERING_PATH}/moduli/${entry.to}`} className="hover:underline">{titleOf(entry.to)}</Link> <span className="tabular-nums text-a-text-3">· {entry.imports} import</span></li>)}</ul>
            )}
          </div>
          <div className="space-y-2">
            <h2 className="text-base font-semibold text-a-text">Importato da</h2>
            {usedBy.length === 0 ? <p className="text-sm text-a-text-3">Nessun altro modulo lo importa.</p> : (
              <ul className="space-y-1 text-sm">{usedBy.map((entry) => <li key={entry.from}><Link href={`${ENGINEERING_PATH}/moduli/${entry.from}`} className="hover:underline">{titleOf(entry.from)}</Link> <span className="tabular-nums text-a-text-3">· {entry.imports} import</span></li>)}</ul>
            )}
          </div>
        </section>
        {imports.truncated && <p className="text-xs text-a-text-3">Elenco import parziale: raggiunto il limite di righe lette.</p>}

        <section aria-labelledby="mod-globs" className="space-y-2">
          <h2 id="mod-globs" className="text-base font-semibold text-a-text">Percorsi assegnati</h2>
          <ul className="space-y-1 font-mono text-xs text-a-text-2">{current.pathGlobs.map((glob) => <li key={glob}>{glob}</li>)}</ul>
          <p className="text-xs text-a-text-3">Registro: <a className="underline" href={githubLink(run.githubOwner, run.githubRepo, run.commitSha, 'apps/storefront/src/lib/engineering/moduleRegistry.ts')} target="_blank" rel="noreferrer noopener">moduleRegistry.ts su GitHub</a></p>
        </section>
      </EngineeringChrome>
    );
  } catch (error) {
    if ((error as { digest?: string })?.digest?.startsWith('NEXT_')) throw error;
    console.error('[platform/engineering] module failed:', (error as { code?: string })?.code ?? 'unknown');
    return <EngineeringChrome active="moduli" title="Modulo"><ErrorState title="Lettura dell’indice non riuscita" supportHint={false} /></EngineeringChrome>;
  }
}
