/**
 * Pure orchestrator loop: planner step -> allow-listed tool -> evidence -> ... -> verified answer.
 * The model and the tools are injected, so the loop is tested without a database or a provider.
 */
import {
  AI_TOOLS, ASK_LIMITS, EvidenceLedger, buildUserMessage, finalizeAnswer, isForbiddenQuestion,
  type AiTool, type Evidence, type HistoryTurn, type PlannerStep,
} from './contract';

export class ToolInputError extends Error {
  constructor(public code: string) { super(code); this.name = 'ToolInputError'; }
}

export interface AskDeps {
  /** One structured model call. Throws on routing/provider failure. */
  plan(input: { user: string }): Promise<PlannerStep>;
  /** Executes an allow-listed tool and records what it found in the ledger. Returns a short log line. */
  runTool(tool: AiTool, step: PlannerStep, ledger: EvidenceLedger): Promise<string>;
}

export type AskOutcome = 'ok' | 'no_answer' | 'refused' | 'error';

export interface AskResult {
  outcome: AskOutcome;
  refusalReason: string | null;
  answer: string;
  citations: Evidence[];
  droppedCitations: number;
  unverifiedPaths: number;
  toolCalls: number;
}

const NO_ANSWER_TEXT = 'Non ho trovato nell’indice prove sufficienti per rispondere. Prova a indicare un modulo, un file o un nome preciso.';

export async function runAsk(params: { question: string; history: HistoryTurn[]; deps: AskDeps; maxToolCalls: number }): Promise<AskResult> {
  const empty = { answer: '', citations: [] as Evidence[], droppedCitations: 0, unverifiedPaths: 0, toolCalls: 0 };
  const question = params.question.trim().slice(0, ASK_LIMITS.maxQuestion);
  if (!question) return { ...empty, outcome: 'refused', refusalReason: 'empty_question' };
  if (isForbiddenQuestion(question)) {
    return { ...empty, outcome: 'refused', refusalReason: 'forbidden_topic', answer: 'Questa domanda riguarda segreti o dati di produzione: il Hub non li indicizza e non risponde.' };
  }

  const ledger = new EvidenceLedger();
  const log: string[] = [];
  let toolCalls = 0;
  const limit = Math.max(1, Math.min(params.maxToolCalls, 12));

  // limit tool steps + one final step where only an answer or a give-up is accepted.
  for (let turn = 0; turn <= limit; turn += 1) {
    const forceAnswer = toolCalls >= limit;
    let step: PlannerStep;
    try {
      step = await params.deps.plan({ user: buildUserMessage({ question, history: params.history, ledger, log, toolsLeft: limit - toolCalls, forceAnswer }) });
    } catch {
      return { ...empty, toolCalls, outcome: 'error', refusalReason: 'model_unavailable' };
    }

    if (step.action === 'give_up') return { ...empty, toolCalls, outcome: 'no_answer', refusalReason: 'model_gave_up', answer: NO_ANSWER_TEXT };

    if (step.action === 'answer') {
      if (!step.answer) { log.push('risposta vuota rifiutata'); if (forceAnswer) break; continue; }
      const finalized = finalizeAnswer(step.answer, step.evidenceIds, ledger);
      if (finalized.citations.length === 0) {
        // An answer with no verifiable citation is not an answer.
        if (forceAnswer) return { ...empty, toolCalls, droppedCitations: finalized.droppedCitations, outcome: 'no_answer', refusalReason: 'no_valid_citation', answer: NO_ANSWER_TEXT };
        log.push('risposta rifiutata: serve almeno una citazione [E…] valida; raccogli prove con uno strumento');
        continue;
      }
      return {
        outcome: 'ok', refusalReason: null, answer: finalized.text, citations: finalized.citations,
        droppedCitations: finalized.droppedCitations, unverifiedPaths: finalized.unverifiedPaths, toolCalls,
      };
    }

    // From here on the step is a tool request. Anything outside the allow-list was rejected by the validator.
    if (forceAnswer || !(AI_TOOLS as readonly string[]).includes(step.action)) { log.push('strumento non disponibile'); if (forceAnswer) break; continue; }
    toolCalls += 1;
    try {
      log.push(await params.deps.runTool(step.action as AiTool, step, ledger));
    } catch (error) {
      log.push(`${step.action}: ${error instanceof ToolInputError ? `argomenti non validi (${error.code})` : 'errore dello strumento'}`);
    }
  }
  return { ...empty, toolCalls, outcome: 'no_answer', refusalReason: 'tool_budget_exhausted', answer: NO_ANSWER_TEXT };
}
