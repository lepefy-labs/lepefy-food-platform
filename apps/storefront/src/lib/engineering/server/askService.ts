import 'server-only';
import { runAi } from '@/lib/ai/core/aiGateway';
import { githubLink } from '../domain';
import { PLANNER_SCHEMA, SYSTEM_PROMPT, sanitizeHistory, validatePlannerStep, ASK_LIMITS, type HistoryTurn } from '../ai/contract';
import { decideAdmission } from '../ai/admission';
import { runAsk, type AskOutcome } from '../ai/orchestrator';
import { getActiveRun } from './activeRun';
import { createUsageSink, loadSettings, recentRequests, recordMetric, spentToday, type Actor } from './metrics';
import { createToolRunner } from './tools';

export interface AskCitation { id: string; path: string; startLine: number | null; endLine: number | null; label: string; url: string }

export type AskResponse =
  | { state: 'answered' | 'no_answer' | 'refused'; answer: string; citations: AskCitation[]; commitSha: string; toolCalls: number }
  | { state: 'disabled' | 'rate_limited' | 'budget_exceeded' | 'empty_index' | 'unavailable' | 'error'; message: string };

const MESSAGES = {
  disabled: 'L’assistente AI è spento. Il Platform Owner deve abilitare la policy di routing «engineering» e l’impostazione AI.',
  rate_limited: 'Troppe domande in un minuto. Riprova tra poco.',
  budget_exceeded: 'Budget giornaliero dell’assistente esaurito.',
  empty_index: 'Nessun indice attivo: l’assistente risponde solo sul repository indicizzato.',
  unavailable: 'Indice o impostazioni non leggibili in questo momento.',
  error: 'L’assistente non è riuscito a rispondere. Nessuna risposta è stata inventata.',
} as const;

/**
 * Engineering AI entry point for the owner chat and the machine API. Order matters: the off
 * switch, the rate limit and the daily budget are checked BEFORE any model is called.
 */
export async function askEngineering(params: { question: unknown; history?: unknown; actor: Actor }): Promise<AskResponse> {
  const started = Date.now();
  const question = typeof params.question === 'string' ? params.question.trim().slice(0, ASK_LIMITS.maxQuestion) : '';
  const active = await getActiveRun();
  if (active.state === 'empty') return { state: 'empty_index', message: MESSAGES.empty_index };
  if (active.state !== 'ready') return { state: 'unavailable', message: MESSAGES.unavailable };
  const run = active.run;
  const metric = (outcome: Parameters<typeof recordMetric>[0]['outcome'], extra: Partial<Parameters<typeof recordMetric>[0]> = {}) =>
    recordMetric({ repositoryId: run.repositoryId, runId: run.runId, actor: params.actor, kind: 'ask', question, outcome, latencyMs: Date.now() - started, ...extra });

  try {
    const settings = await loadSettings(run.repositoryId);
    if (!settings) return { state: 'unavailable', message: MESSAGES.unavailable };
    const admission = decideAdmission({
      aiEnabled: settings.aiEnabled,
      recentCount: settings.aiEnabled ? await recentRequests(run.repositoryId, params.actor) : 0,
      perMinuteLimit: settings.perMinuteLimit,
      spentTodayUsd: settings.aiEnabled ? await spentToday(run.repositoryId) : 0,
      dailyBudgetUsd: settings.dailyBudgetUsd,
    });
    if (admission !== 'ok') {
      await metric(admission);
      return { state: admission, message: MESSAGES[admission] };
    }

    const history: HistoryTurn[] = sanitizeHistory(params.history);
    const runTool = createToolRunner(run);
    const usageSink = createUsageSink(run.repositoryId);
    const result = await runAsk({
      question, history, maxToolCalls: settings.maxToolCalls,
      deps: {
        plan: async ({ user }) => {
          const response = await runAi({
            tenantId: null, consumer: 'engineering', capability: 'structured_chat', endpoint: 'engineering_ask', usageSink,
            request: {
              system: SYSTEM_PROMPT, messages: [{ role: 'user', content: user }], responseSchema: PLANNER_SCHEMA,
              validate: validatePlannerStep, temperature: 0, maxOutputTokens: 1500,
            },
          });
          return response.structured;
        },
        runTool,
      },
    });

    const outcome: AskOutcome = result.outcome;
    await metric(outcome === 'ok' ? 'ok' : outcome, {
      refusalReason: result.refusalReason, toolCalls: result.toolCalls, citations: result.citations.length, droppedCitations: result.droppedCitations,
    });
    if (outcome === 'error') return { state: 'error', message: MESSAGES.error };
    const citations: AskCitation[] = result.citations.map((item) => ({
      id: item.id, path: item.path, startLine: item.startLine, endLine: item.endLine, label: item.label,
      url: githubLink(run.githubOwner, run.githubRepo, run.commitSha, item.path, item.startLine ?? undefined, item.endLine ?? undefined),
    }));
    return { state: outcome === 'ok' ? 'answered' : outcome, answer: result.answer, citations, commitSha: run.commitSha, toolCalls: result.toolCalls };
  } catch (error) {
    console.error('[engineering/ask] failed:', (error as { code?: string })?.code ?? 'unknown');
    await metric('error', { refusalReason: 'exception' });
    return { state: 'error', message: MESSAGES.error };
  }
}
