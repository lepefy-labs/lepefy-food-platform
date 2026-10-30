/**
 * Engineering Hub: run the benchmark questions against the machine API (it CALLS THE AI MODEL, so it costs money).
 *
 *   ENGINEERING_API_URL=https://shop.chloefood.com ENGINEERING_API_TOKEN=lpe_eng_... pnpm engineering:benchmark
 *
 * The credential needs the `ask` scope. The assistant must be enabled; otherwise every question is
 * reported as failed (not as a wrong answer). Questions are never part of CI: run it by hand after
 * changing the prompt, the tools, the model or the index.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scoreBenchmark, type BenchmarkAnswer, type BenchmarkQuestion } from '../src/lib/engineering/benchmark';
import { repoRoot } from './engineeringGit';

const base = (process.env.ENGINEERING_API_URL ?? '').replace(/\/+$/, '');
const token = process.env.ENGINEERING_API_TOKEN ?? '';
if (!/^https:\/\/[^/\s]+$/.test(base) || !token.startsWith('lpe_eng_')) {
  console.error('[engineering-benchmark] ENGINEERING_API_URL (https origin) and ENGINEERING_API_TOKEN (lpe_eng_…) are required');
  process.exit(2);
}

const questions = (JSON.parse(readFileSync(resolve(repoRoot(), 'docs/engineering/benchmark/questions.json'), 'utf8')) as { questions: BenchmarkQuestion[] }).questions;
const answers: BenchmarkAnswer[] = [];

for (const question of questions) {
  const started = Date.now();
  let state = 'error';
  let citedPaths: string[] = [];
  try {
    const response = await fetch(`${base}/api/engineering/v1/ask`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ question: question.question }),
      signal: AbortSignal.timeout(70_000),
    });
    const body = (await response.json().catch(() => ({}))) as { state?: string; citations?: Array<{ path: string }> };
    state = body.state ?? (response.status === 401 ? 'unauthorized' : 'error');
    citedPaths = (body.citations ?? []).map((citation) => citation.path);
  } catch { /* reported as failed */ }
  answers.push({ id: question.id, state, citedPaths, latencyMs: Date.now() - started });
  console.log(`${question.id} ${state} ${citedPaths.length} citazioni ${Date.now() - started} ms`);
  // The machine API rate limit is per minute; stay well under it.
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 7000));
}

const report = scoreBenchmark(questions, answers);
console.log(JSON.stringify(report, null, 2));
process.exit(report.failed.length === report.total ? 1 : 0);
