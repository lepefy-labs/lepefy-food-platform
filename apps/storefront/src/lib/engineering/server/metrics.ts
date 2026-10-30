import 'server-only';
import { createHash } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import type { AiUsageEvent } from '@/lib/ai/core/aiGateway';
import { estimateCostUsd, startOfUtcDay } from '../ai/admission';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
const db = (): Db => createServiceClient();

export interface EngineeringSettings { aiEnabled: boolean; dailyBudgetUsd: number; perMinuteLimit: number; maxToolCalls: number }

export async function loadSettings(repositoryId: string): Promise<EngineeringSettings | null> {
  const { data, error } = await db().from('engineering_settings')
    .select('ai_enabled, daily_budget_usd, per_minute_limit, max_tool_calls').eq('repository_id', repositoryId).maybeSingle();
  if (error || !data) return null;
  return { aiEnabled: data.ai_enabled === true, dailyBudgetUsd: Number(data.daily_budget_usd), perMinuteLimit: data.per_minute_limit, maxToolCalls: data.max_tool_calls };
}

export interface Actor { kind: 'owner' | 'machine'; clientId: string | null }

/** Requests by this actor in the last minute (owner: all owner requests; machine: that client). */
export async function recentRequests(repositoryId: string, actor: Actor): Promise<number> {
  let query = db().from('engineering_query_metrics').select('id', { count: 'exact', head: true })
    .eq('repository_id', repositoryId).eq('actor_kind', actor.kind).gte('created_at', new Date(Date.now() - 60_000).toISOString());
  query = actor.clientId ? query.eq('client_id', actor.clientId) : query;
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function spentToday(repositoryId: string): Promise<number> {
  const { data, error } = await db().from('engineering_ai_usage').select('estimated_cost_usd')
    .eq('repository_id', repositoryId).gte('created_at', startOfUtcDay()).limit(5000);
  if (error) throw error;
  return ((data ?? []) as Array<{ estimated_cost_usd: number | string }>).reduce((sum, row) => sum + Number(row.estimated_cost_usd), 0);
}

/** Usage sink handed to the AI gateway for the tenant-less engineering consumer (decision D2). */
export function createUsageSink(repositoryId: string) {
  return async (event: AiUsageEvent): Promise<void> => {
    try {
      const { data: pricing } = await db().from('ai_pricing').select('input_price_per_million, output_price_per_million')
        .eq('provider', event.provider).eq('model', event.model).eq('active', true).maybeSingle();
      await db().from('engineering_ai_usage').insert({
        repository_id: repositoryId, endpoint: event.endpoint.slice(0, 80), provider: event.provider, model: event.model, status: event.status,
        input_tokens: event.inputTokens ?? null, output_tokens: event.outputTokens ?? null,
        estimated_cost_usd: estimateCostUsd(event.inputTokens, event.outputTokens, pricing?.input_price_per_million ?? null, pricing?.output_price_per_million ?? null),
        latency_ms: event.latencyMs, fallback_used: event.fallbackUsed, fallback_reason: event.fallbackReason,
      });
    } catch (error) {
      console.error('[engineering/usage] insert failed:', (error as { code?: string })?.code ?? 'unknown');
    }
  };
}

export interface MetricInput {
  repositoryId: string;
  runId: string | null;
  actor: Actor;
  kind: 'search' | 'ask';
  question: string | null;
  outcome: 'ok' | 'refused' | 'no_answer' | 'rate_limited' | 'budget_exceeded' | 'disabled' | 'error';
  refusalReason?: string | null;
  latencyMs: number;
  toolCalls?: number;
  citations?: number;
  droppedCitations?: number;
  resultCount?: number | null;
}

/** Never throws. The question is stored as a hash and a length only. */
export async function recordMetric(input: MetricInput): Promise<void> {
  try {
    await db().from('engineering_query_metrics').insert({
      repository_id: input.repositoryId, run_id: input.runId, actor_kind: input.actor.kind, client_id: input.actor.clientId, kind: input.kind,
      question_hash: input.question ? createHash('sha256').update(input.question).digest('hex') : null,
      question_length: input.question ? Math.min(input.question.length, 2000) : null,
      outcome: input.outcome, refusal_reason: input.refusalReason?.slice(0, 60) ?? null, latency_ms: Math.round(input.latencyMs),
      tool_calls: input.toolCalls ?? 0, citations: input.citations ?? 0, dropped_citations: Math.min(input.droppedCitations ?? 0, 100), result_count: input.resultCount ?? null,
    });
  } catch (error) {
    console.error('[engineering/metrics] insert failed:', (error as { code?: string })?.code ?? 'unknown');
  }
}
