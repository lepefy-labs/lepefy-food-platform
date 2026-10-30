/** Pure aggregation of Engineering Hub usage: queries, answers, latency, citations, AI cost. */

export interface MetricRow {
  kind: 'search' | 'ask';
  actor_kind: 'owner' | 'machine';
  outcome: string;
  latency_ms: number | null;
  tool_calls: number;
  citations: number;
  dropped_citations: number;
  created_at: string;
}

export interface UsageRow {
  provider: string;
  model: string;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | string;
  created_at: string;
}

export interface MetricsSummary {
  searches: number;
  asks: number;
  byOutcome: Record<string, number>;
  /** Share of asks that ended with a cited answer; null with no asks (never 0 %). */
  answerRate: number | null;
  /** Dropped model citations over all model citations; null with none. */
  droppedCitationRate: number | null;
  avgToolCalls: number | null;
  latency: { p50: number | null; p95: number | null };
  machineShare: number | null;
  daily: Array<{ day: string; searches: number; asks: number }>;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

export function summarizeMetrics(rows: MetricRow[]): MetricsSummary {
  const asks = rows.filter((row) => row.kind === 'ask');
  const answered = asks.filter((row) => row.outcome === 'ok');
  const byOutcome: Record<string, number> = {};
  for (const row of rows) byOutcome[row.outcome] = (byOutcome[row.outcome] ?? 0) + 1;
  // Only asks that really reached the orchestrator count toward quality figures.
  const reached = asks.filter((row) => ['ok', 'no_answer', 'refused', 'error'].includes(row.outcome));
  const citations = reached.reduce((sum, row) => sum + row.citations, 0);
  const dropped = reached.reduce((sum, row) => sum + row.dropped_citations, 0);
  const days = new Map<string, { searches: number; asks: number }>();
  for (const row of rows) {
    const day = row.created_at.slice(0, 10);
    const entry = days.get(day) ?? { searches: 0, asks: 0 };
    if (row.kind === 'search') entry.searches += 1; else entry.asks += 1;
    days.set(day, entry);
  }
  const latencies = rows.map((row) => row.latency_ms).filter((value): value is number => typeof value === 'number');
  return {
    searches: rows.length - asks.length,
    asks: asks.length,
    byOutcome,
    answerRate: reached.length ? answered.length / reached.length : null,
    droppedCitationRate: citations + dropped > 0 ? dropped / (citations + dropped) : null,
    avgToolCalls: reached.length ? reached.reduce((sum, row) => sum + row.tool_calls, 0) / reached.length : null,
    latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    machineShare: rows.length ? rows.filter((row) => row.actor_kind === 'machine').length / rows.length : null,
    daily: [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, value]) => ({ day, ...value })),
  };
}

export interface CostSummary {
  today: number;
  last7Days: number;
  last30Days: number;
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  byModel: Array<{ model: string; calls: number; costUsd: number }>;
}

export function summarizeCost(rows: UsageRow[], now: Date = new Date()): CostSummary {
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const summary: CostSummary = { today: 0, last7Days: 0, last30Days: 0, calls: rows.length, failedCalls: 0, inputTokens: 0, outputTokens: 0, byModel: [] };
  const byModel = new Map<string, { calls: number; costUsd: number }>();
  for (const row of rows) {
    const cost = Number(row.estimated_cost_usd) || 0;
    const time = Date.parse(row.created_at);
    if (time >= startOfToday) summary.today += cost;
    if (time >= startOfToday - 6 * 86_400_000) summary.last7Days += cost;
    if (time >= startOfToday - 29 * 86_400_000) summary.last30Days += cost;
    if (row.status !== 'success') summary.failedCalls += 1;
    summary.inputTokens += row.input_tokens ?? 0;
    summary.outputTokens += row.output_tokens ?? 0;
    const key = `${row.provider}/${row.model}`;
    const entry = byModel.get(key) ?? { calls: 0, costUsd: 0 };
    entry.calls += 1;
    entry.costUsd += cost;
    byModel.set(key, entry);
  }
  summary.byModel = [...byModel.entries()].map(([model, value]) => ({ model, ...value })).sort((a, b) => b.costUsd - a.costUsd);
  return summary;
}
