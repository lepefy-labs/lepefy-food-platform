/** Pure scoring of the Engineering AI benchmark (docs/engineering/benchmark/questions.json). */

export interface BenchmarkQuestion { id: string; question: string; expectedPaths: string[] }

export interface BenchmarkAnswer {
  id: string;
  state: string;
  citedPaths: string[];
  latencyMs: number;
}

export interface BenchmarkReport {
  total: number;
  answered: number;
  /** Answers citing at least one expected path / all questions. */
  hit: number;
  /** Answers that cited every expected path. */
  complete: number;
  /** Answers that cited something, but nothing expected. */
  offTarget: string[];
  /** Questions with no answer (the system said it did not know). */
  unanswered: string[];
  /** Hard failures (disabled, rate limited, error): excluded from quality rates. */
  failed: string[];
  hitRate: number | null;
  answerRate: number | null;
  avgLatencyMs: number | null;
}

export function scoreBenchmark(questions: BenchmarkQuestion[], answers: BenchmarkAnswer[]): BenchmarkReport {
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const report: BenchmarkReport = { total: questions.length, answered: 0, hit: 0, complete: 0, offTarget: [], unanswered: [], failed: [], hitRate: null, answerRate: null, avgLatencyMs: null };
  let graded = 0;
  let latency = 0;
  for (const question of questions) {
    const answer = byId.get(question.id);
    if (!answer || ['disabled', 'rate_limited', 'budget_exceeded', 'error', 'unavailable', 'empty_index'].includes(answer.state)) { report.failed.push(question.id); continue; }
    graded += 1;
    latency += answer.latencyMs;
    if (answer.state !== 'answered') { report.unanswered.push(question.id); continue; }
    report.answered += 1;
    const cited = new Set(answer.citedPaths);
    const matched = question.expectedPaths.filter((path) => cited.has(path)).length;
    if (matched > 0) report.hit += 1; else report.offTarget.push(question.id);
    if (matched === question.expectedPaths.length) report.complete += 1;
  }
  report.hitRate = graded ? report.hit / graded : null;
  report.answerRate = graded ? report.answered / graded : null;
  report.avgLatencyMs = graded ? Math.round(latency / graded) : null;
  return report;
}
