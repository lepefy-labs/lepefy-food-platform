import Link from 'next/link';
import { IconFile, IconFolder } from '@tabler/icons-react';
import { formatNumber } from '@/lib/admin/format';
import { githubLink, type RelationKind } from '@/lib/engineering/domain';
import { getActiveRun } from '@/lib/engineering/server/activeRun';
import { loadFileRelations, loadFileSource, loadFileSymbols, loadFiles, type RelationRow } from '@/lib/engineering/server/repository';
import { listDirectory, parentDirectory, sanitizeRepoPath } from '@/lib/engineering/explorer';
import Badge from '../../../../_components/ui/Badge';
import { EmptyState, ErrorState } from '../../../../_components/ui/States';
import { ENGINEERING_PATH, EngineeringChrome, IndexBanner, IndexGate } from '../_components/EngineeringChrome';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const MAX_SOURCE_LINES = 2500;
const RELATION_TITLES: Record<RelationKind, string> = {
  imports: 'Importa', tests: 'Testa', calls_rpc: 'Chiama RPC', uses_table: 'Usa tabella', calls_api: 'Chiama API',
  handles_route: 'Gestisce la rotta', defines_object: 'Definisce', documents: 'Documenta',
};
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

export default async function EngineeringCodePage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const gate = IndexGate({ result: await getActiveRun() });
  if (!gate.run) return <EngineeringChrome active="codice" title="Codice">{gate.fallback}</EngineeringChrome>;
  const run = gate.run;

  const path = sanitizeRepoPath(first(searchParams.path));
  const dirParam = sanitizeRepoPath(first(searchParams.dir));
  const highlight = Math.max(0, Number.parseInt(first(searchParams.line), 10) || 0);

  try {
    const files = await loadFiles(run.runId);
    const fileByPath = new Map(files.map((file) => [file.path, file]));
    const fileById = new Map(files.map((file) => [file.id, file]));

    if (path) {
      const entry = fileByPath.get(path);
      const source = entry ? await loadFileSource(run.repositoryId, run.runId, path) : null;
      if (!entry || !source) {
        return (
          <EngineeringChrome active="codice" title="Codice" breadcrumb={[{ label: 'Codice', href: `${ENGINEERING_PATH}/codice` }]}>
            <EmptyState title="File non presente nell’indice" description="Il percorso non esiste nello snapshot attivo, oppure il file è escluso dall’indice (segreti, dati personali, binari)." />
          </EngineeringChrome>
        );
      }
      const [symbols, relations] = await Promise.all([loadFileSymbols(run.runId, entry.id), loadFileRelations(run.runId, entry.id)]);
      const lines = source.content.split('\n');
      const shown = lines.slice(0, MAX_SOURCE_LINES);
      const describe = (row: RelationRow) => (row.otherFileId ? fileById.get(row.otherFileId)?.path ?? null : null) ?? row.targetRef;
      const group = (rows: RelationRow[]) => {
        const grouped = new Map<RelationKind, RelationRow[]>();
        for (const row of rows) grouped.set(row.kind, [...(grouped.get(row.kind) ?? []), row]);
        return [...grouped.entries()];
      };
      const parent = parentDirectory(path);

      return (
        <EngineeringChrome active="codice" title={path.slice(path.lastIndexOf('/') + 1)} description={path} breadcrumb={[{ label: 'Codice', href: `${ENGINEERING_PATH}/codice` }, ...(parent ? [{ label: parent, href: `${ENGINEERING_PATH}/codice?dir=${encodeURIComponent(parent)}` }] : [])]}>
          <IndexBanner run={run} />
          <div className="flex flex-wrap items-center gap-2 text-sm text-a-text-2">
            <Badge tone="neutral">{entry.kind}</Badge>
            {entry.moduleKey && <Link href={`${ENGINEERING_PATH}/moduli/${entry.moduleKey}`}><Badge tone="info">{entry.moduleKey}</Badge></Link>}
            <span>{formatNumber(entry.lineCount)} righe · {formatNumber(entry.sizeBytes)} byte</span>
            <a className="underline" href={githubLink(run.githubOwner, run.githubRepo, run.commitSha, path)} target="_blank" rel="noreferrer noopener">Apri su GitHub al commit {run.commitSha.slice(0, 8)}</a>
          </div>

          {symbols.length > 0 && (
            <section aria-labelledby="code-symbols" className="space-y-2">
              <h2 id="code-symbols" className="text-base font-semibold text-a-text">Simboli ({symbols.length})</h2>
              <div className="max-h-80 overflow-auto rounded-[10px] border border-a-border bg-a-surface">
                <table className="w-full border-separate border-spacing-0 text-sm text-a-text">
                  <caption className="sr-only">Simboli del file</caption>
                  <tbody>
                    {symbols.map((symbol) => (
                      <tr key={`${symbol.name}@${symbol.startLine}`}>
                        <td className="border-b border-a-border px-3 py-1.5 font-mono text-xs"><Link href={`${ENGINEERING_PATH}/codice?path=${encodeURIComponent(path)}&line=${symbol.startLine}#L${symbol.startLine}`} className="hover:underline">{symbol.parentName ? `${symbol.parentName}.` : ''}{symbol.name}</Link></td>
                        <td className="border-b border-a-border px-3 py-1.5"><Badge tone="neutral">{symbol.kind}</Badge></td>
                        <td className="border-b border-a-border px-3 py-1.5 text-xs text-a-text-3">{symbol.exported ? 'esportato' : ''}</td>
                        <td className="border-b border-a-border px-3 py-1.5 text-right text-xs tabular-nums text-a-text-3">righe {symbol.startLine}–{symbol.endLine}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {(relations.out.length > 0 || relations.in.length > 0) && (
            <section aria-labelledby="code-relations" className="grid gap-4 md:grid-cols-2">
              <h2 id="code-relations" className="sr-only">Relazioni dimostrate</h2>
              {([['In uscita', relations.out], ['In ingresso', relations.in]] as const).map(([title, rows]) => (
                <div key={title} className="space-y-2">
                  <h3 className="text-sm font-semibold text-a-text">{title} ({rows.length})</h3>
                  {rows.length === 0 ? <p className="text-sm text-a-text-3">Nessuna.</p> : group(rows as RelationRow[]).map(([kind, items]) => (
                    <div key={kind}>
                      <p className="text-xs font-semibold text-a-text-2">{RELATION_TITLES[kind]}</p>
                      <ul className="space-y-0.5">
                        {items.slice(0, 25).map((item, index) => {
                          const label = describe(item);
                          const isFile = item.otherFileId && label && fileByPath.has(label);
                          return (
                            <li key={`${label}-${index}`} className="truncate font-mono text-xs text-a-text-2">
                              {isFile ? <Link href={`${ENGINEERING_PATH}/codice?path=${encodeURIComponent(label!)}`} className="hover:underline">{label}</Link> : label}
                              {item.evidenceLine ? <span className="text-a-text-3"> · riga {item.evidenceLine}</span> : null}
                            </li>
                          );
                        })}
                      </ul>
                      {items.length > 25 && <p className="text-xs text-a-text-3">+{items.length - 25} altre</p>}
                    </div>
                  ))}
                </div>
              ))}
            </section>
          )}

          <section aria-labelledby="code-source" className="space-y-2">
            <h2 id="code-source" className="text-base font-semibold text-a-text">Sorgente al commit {run.commitSha.slice(0, 8)}</h2>
            <div className="overflow-auto rounded-[10px] border border-a-border bg-a-surface-2">
              <pre className="min-w-max p-0 font-mono text-xs leading-5 text-a-text">
                {shown.map((text, index) => {
                  const number = index + 1;
                  return (
                    <div key={number} id={`L${number}`} className={`flex ${number === highlight ? 'bg-tone-warning-bg' : ''}`}>
                      <a href={`#L${number}`} className="w-12 shrink-0 select-none px-2 text-right text-a-text-3 hover:text-a-text" aria-label={`Riga ${number}`}>{number}</a>
                      <code className="whitespace-pre pr-4">{text || ' '}</code>
                    </div>
                  );
                })}
              </pre>
            </div>
            {lines.length > shown.length && <p className="text-xs text-a-text-3">Mostrate {formatNumber(shown.length)} righe su {formatNumber(lines.length)}: il resto è su GitHub.</p>}
          </section>
        </EngineeringChrome>
      );
    }

    const listing = listDirectory(files, dirParam);
    const parent = dirParam ? parentDirectory(dirParam) : null;
    return (
      <EngineeringChrome active="codice" title="Codice" description={dirParam ? dirParam : 'Esplora i file indicizzati del repository, sempre al commit dell’indice attivo.'}>
        <IndexBanner run={run} />
        {listing.directories.length === 0 && listing.files.length === 0 ? (
          <EmptyState title="Cartella vuota o non indicizzata" description="Nessun file indicizzato sotto questo percorso." />
        ) : (
          <ul className="divide-y divide-a-border rounded-[10px] border border-a-border bg-a-surface text-sm">
            {parent !== null && (
              <li><Link className="flex items-center gap-2 px-3 py-2 hover:bg-a-surface-2" href={parent ? `${ENGINEERING_PATH}/codice?dir=${encodeURIComponent(parent)}` : `${ENGINEERING_PATH}/codice`}><IconFolder size={16} aria-hidden="true" />..</Link></li>
            )}
            {listing.directories.map((directory) => (
              <li key={directory.path}>
                <Link className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-a-surface-2" href={`${ENGINEERING_PATH}/codice?dir=${encodeURIComponent(directory.path)}`}>
                  <span className="flex items-center gap-2"><IconFolder size={16} aria-hidden="true" />{directory.name}</span>
                  <span className="text-xs tabular-nums text-a-text-3">{formatNumber(directory.files)} file</span>
                </Link>
              </li>
            ))}
            {listing.files.map((file) => (
              <li key={file.id}>
                <Link className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-a-surface-2" href={`${ENGINEERING_PATH}/codice?path=${encodeURIComponent(file.path)}`}>
                  <span className="flex min-w-0 items-center gap-2"><IconFile size={16} aria-hidden="true" /><span className="truncate">{file.path.slice(file.path.lastIndexOf('/') + 1)}</span></span>
                  <span className="shrink-0 text-xs tabular-nums text-a-text-3">{file.kind} · {formatNumber(file.lineCount)} righe</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </EngineeringChrome>
    );
  } catch (error) {
    console.error('[platform/engineering] code failed:', (error as { code?: string })?.code ?? 'unknown');
    return <EngineeringChrome active="codice" title="Codice"><ErrorState title="Lettura dell’indice non riuscita" supportHint={false} /></EngineeringChrome>;
  }
}
