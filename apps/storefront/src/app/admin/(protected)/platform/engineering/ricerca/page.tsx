import Link from 'next/link';
import { getActiveRun } from '@/lib/engineering/server/activeRun';
import { loadModules } from '@/lib/engineering/server/repository';
import { searchEngineering } from '@/lib/engineering/server/search';
import { normalizeQuery, type SearchHit, type SearchStage } from '@/lib/engineering/search/contract';
import Badge from '../../../../_components/ui/Badge';
import { EmptyState, ErrorState } from '../../../../_components/ui/States';
import { ENGINEERING_PATH, EngineeringChrome, IndexBanner, IndexGate, SearchForm } from '../_components/EngineeringChrome';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const STAGE_LABELS: Record<SearchStage, string> = { exact: 'Esatta', prefix: 'Prefisso', fulltext: 'Testo', fuzzy: 'Contiene' };
const KIND_LABELS: Record<SearchHit['kind'], string> = { symbol: 'Simbolo', file: 'File', document: 'Documento', chunk: 'Sezione' };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

export default async function EngineeringSearchPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const gate = IndexGate({ result: await getActiveRun() });
  if (!gate.run) return <EngineeringChrome active="ricerca" title="Ricerca">{gate.fallback}</EngineeringChrome>;
  const run = gate.run;

  const query = normalizeQuery(first(searchParams.q));
  const moduleParam = first(searchParams.module);
  const moduleKey = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(moduleParam) ? moduleParam : '';
  let modules: Awaited<ReturnType<typeof loadModules>> = [];
  try { modules = await loadModules(run.runId); } catch { /* the search form works without the module filter */ }
  const outcome = query ? await searchEngineering({ query, moduleKey: moduleKey || null }) : null;

  return (
    <EngineeringChrome active="ricerca" title="Ricerca" description="Cerca simboli, file, documenti e sezioni. Ordine: nome esatto, prefisso, testo, poi corrispondenza parziale.">
      <IndexBanner run={run} />
      <SearchForm defaultValue={query} moduleKey={moduleKey} modules={modules} />

      {!outcome && <EmptyState title="Scrivi cosa cerchi" description="Esempi: validateCheckoutItems, orders_select_own, /api/checkout, fulfillment_policy." />}
      {outcome?.state === 'invalid' && <EmptyState variant="filtered" title="Query troppo corta" description="Servono almeno due caratteri." />}
      {outcome?.state === 'unavailable' && <ErrorState title="Ricerca non disponibile" description="L’indice non è leggibile in questo momento." supportHint={false} />}
      {outcome?.state === 'empty_index' && <EmptyState title="Nessun indice attivo" />}
      {outcome?.state === 'ok' && (
        outcome.hits.length === 0 ? <EmptyState variant="filtered" title="Nessun risultato" description="Prova un termine più breve o un altro modulo." /> : (
          <>
            <p className="text-sm text-a-text-2">{outcome.total > outcome.hits.length ? `Primi ${outcome.hits.length} di ${outcome.total} risultati.` : `${outcome.total} risultati.`}</p>
            <ol className="divide-y divide-a-border rounded-[10px] border border-a-border bg-a-surface">
              {outcome.hits.map((hit) => (
                <li key={hit.key} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`${ENGINEERING_PATH}/codice?path=${encodeURIComponent(hit.path)}${hit.startLine ? `&line=${hit.startLine}#L${hit.startLine}` : ''}`}
                      className="font-semibold text-a-text hover:underline"
                    >{hit.title}</Link>
                    <Badge tone="neutral">{KIND_LABELS[hit.kind]}{hit.detail ? ` · ${hit.detail}` : ''}</Badge>
                    <Badge tone={hit.stage === 'exact' ? 'success' : 'info'}>{STAGE_LABELS[hit.stage]}</Badge>
                  </div>
                  <p className="break-all font-mono text-xs text-a-text-3">{hit.path}{hit.startLine ? `:${hit.startLine}` : ''}</p>
                  {hit.snippet && <p className="text-sm text-a-text-2">{hit.snippet}</p>}
                </li>
              ))}
            </ol>
          </>
        )
      )}
    </EngineeringChrome>
  );
}
