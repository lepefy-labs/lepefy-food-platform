import { createServiceClient } from '@/lib/supabase/server';
import { formatDate, formatNumber } from '@/lib/admin/format';
import { getActiveRun } from '@/lib/engineering/server/activeRun';
import { summarizeCost, summarizeMetrics, type MetricRow, type UsageRow } from '@/lib/engineering/metricsSummary';
import AdminStatCard from '../../../../_components/ui/AdminStatCard';
import Badge from '../../../../_components/ui/Badge';
import { EmptyState, ErrorState } from '../../../../_components/ui/States';
import { EngineeringChrome, IndexBanner, IndexGate } from '../_components/EngineeringChrome';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const NA = <span className="text-a-text-3">n.d.</span>;
const pct = (value: number | null) => (value === null ? NA : `${(value * 100).toFixed(0)} %`);
const ms = (value: number | null) => (value === null ? NA : `${formatNumber(value)} ms`);
const usd = (value: number) => `${value.toFixed(value < 1 ? 4 : 2)} $`;
const OUTCOME_LABELS: Record<string, string> = {
  ok: 'Risposte con fonti', no_answer: 'Senza prove sufficienti', refused: 'Rifiutate', rate_limited: 'Limite al minuto',
  budget_exceeded: 'Budget esaurito', disabled: 'Assistente spento', error: 'Errori',
};

interface RunRow { id: string; status: string; branch: string; commit_sha: string; mode: string; trigger: string; started_at: string; finished_at: string | null; error_code: string | null; file_count: number | null }

export default async function EngineeringMetricsPage() {
  const gate = IndexGate({ result: await getActiveRun() });
  if (!gate.run) return <EngineeringChrome active="metriche" title="Metriche e costi">{gate.fallback}</EngineeringChrome>;
  const run = gate.run;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = createServiceClient() as any;
    const [metrics, usage, runs] = await Promise.all([
      db.from('engineering_query_metrics').select('kind, actor_kind, outcome, latency_ms, tool_calls, citations, dropped_citations, created_at').eq('repository_id', run.repositoryId).gte('created_at', since).order('created_at', { ascending: false }).limit(5000),
      db.from('engineering_ai_usage').select('provider, model, status, input_tokens, output_tokens, estimated_cost_usd, created_at').eq('repository_id', run.repositoryId).gte('created_at', since).order('created_at', { ascending: false }).limit(5000),
      db.from('engineering_index_runs').select('id, status, branch, commit_sha, mode, trigger, started_at, finished_at, error_code, file_count').eq('repository_id', run.repositoryId).order('started_at', { ascending: false }).limit(10),
    ]);
    if (metrics.error || usage.error || runs.error) throw metrics.error ?? usage.error ?? runs.error;

    const summary = summarizeMetrics(metrics.data as MetricRow[]);
    const cost = summarizeCost(usage.data as UsageRow[]);
    const empty = summary.searches + summary.asks === 0;

    return (
      <EngineeringChrome active="metriche" title="Metriche e costi" description="Ultimi 30 giorni. Le domande non sono salvate: restano solo esito, durata e conteggi.">
        <IndexBanner run={run} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AdminStatCard title="Ricerche" value={formatNumber(summary.searches)} tone="neutral" />
          <AdminStatCard title="Domande all’AI" value={formatNumber(summary.asks)} description={`risposte con fonti: ${summary.answerRate === null ? 'n.d.' : `${(summary.answerRate * 100).toFixed(0)} %`}`} tone="info" />
          <AdminStatCard title="Costo AI oggi" value={usd(cost.today)} description={`30 giorni: ${usd(cost.last30Days)}`} tone={cost.today > 0 ? 'warning' : 'neutral'} />
          <AdminStatCard title="Latenza p95" value={summary.latency.p95 === null ? 'n.d.' : `${formatNumber(summary.latency.p95)} ms`} description={`p50: ${summary.latency.p50 === null ? 'n.d.' : `${formatNumber(summary.latency.p50)} ms`}`} tone="neutral" />
        </div>

        {empty ? (
          <EmptyState title="Nessuna richiesta negli ultimi 30 giorni" description="Le cifre compaiono quando la ricerca o l’assistente vengono usati." />
        ) : (
          <section aria-labelledby="m-quality" className="space-y-2">
            <h2 id="m-quality" className="text-base font-semibold text-a-text">Qualità delle risposte</h2>
            <ul className="grid gap-2 text-sm text-a-text-2 sm:grid-cols-2">
              <li>Strumenti per domanda (media): <b className="text-a-text">{summary.avgToolCalls === null ? NA : summary.avgToolCalls.toFixed(1)}</b></li>
              <li>Citazioni scartate dal server: <b className="text-a-text">{pct(summary.droppedCitationRate)}</b></li>
              <li>Quota da credenziali macchina: <b className="text-a-text">{pct(summary.machineShare)}</b></li>
              <li>Chiamate al modello: <b className="text-a-text">{formatNumber(cost.calls)}</b> ({formatNumber(cost.failedCalls)} non riuscite) · token {formatNumber(cost.inputTokens)} in / {formatNumber(cost.outputTokens)} out</li>
            </ul>
            <ul className="flex flex-wrap gap-2">
              {Object.entries(summary.byOutcome).map(([outcome, count]) => <li key={outcome}><Badge tone={outcome === 'ok' ? 'success' : outcome === 'error' ? 'danger' : 'neutral'}>{OUTCOME_LABELS[outcome] ?? outcome} · {count}</Badge></li>)}
            </ul>
            {cost.byModel.length > 0 && (
              <p className="text-xs text-a-text-3">Per modello: {cost.byModel.map((entry) => `${entry.model} ${entry.calls} chiamate ${usd(entry.costUsd)}`).join(' · ')}. Un modello senza tariffa in <code>ai_pricing</code> conta 0 $.</p>
            )}
          </section>
        )}

        <section aria-labelledby="m-runs" className="space-y-2">
          <h2 id="m-runs" className="text-base font-semibold text-a-text">Ultime sincronizzazioni</h2>
          <div className="overflow-x-auto rounded-[10px] border border-a-border bg-a-surface">
            <table className="w-full border-separate border-spacing-0 text-sm text-a-text">
              <caption className="sr-only">Esecuzioni di indicizzazione</caption>
              <thead><tr>{['Avvio', 'Commit', 'Ramo', 'Modalità', 'Origine', 'File', 'Stato'].map((header) => <th key={header} scope="col" className="border-b border-a-border bg-a-surface-2 px-3 py-2 text-left text-xs font-semibold text-a-text-2">{header}</th>)}</tr></thead>
              <tbody>
                {(runs.data as RunRow[]).map((row) => (
                  <tr key={row.id}>
                    <td className="border-b border-a-border px-3 py-2 text-a-text-2">{formatDate(row.started_at, 'datetime')}</td>
                    <td className="border-b border-a-border px-3 py-2 font-mono text-xs">{row.commit_sha.slice(0, 8)}</td>
                    <td className="border-b border-a-border px-3 py-2">{row.branch}</td>
                    <td className="border-b border-a-border px-3 py-2">{row.mode}</td>
                    <td className="border-b border-a-border px-3 py-2">{row.trigger}</td>
                    <td className="border-b border-a-border px-3 py-2 tabular-nums">{row.file_count === null ? NA : formatNumber(row.file_count)}</td>
                    <td className="border-b border-a-border px-3 py-2"><Badge tone={row.status === 'active' ? 'success' : row.status === 'failed' ? 'danger' : row.status === 'running' ? 'info' : 'neutral'} dot>{row.status}{row.error_code ? ` · ${row.error_code}` : ''}</Badge></td>
                  </tr>
                ))}
                {runs.data.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-a-text-3">Nessuna sincronizzazione.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </EngineeringChrome>
    );
  } catch (error) {
    console.error('[platform/engineering] metrics failed:', (error as { code?: string })?.code ?? 'unknown');
    return <EngineeringChrome active="metriche" title="Metriche e costi"><ErrorState title="Metriche non disponibili" description="Verifica che la migration 176 sia applicata." supportHint={false} /></EngineeringChrome>;
  }
}
