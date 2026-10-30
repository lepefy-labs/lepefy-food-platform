import { test, expect } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { snapshotFromGit, repoRoot } from '../../scripts/engineeringGit';
import { gitBlobSha } from '../../src/lib/engineering/indexer/buildSnapshot';
import { INGEST_LIMITS, IngestError, batchRows, mapRows, parseBlobs, parseManifest, parseShas, parseStart, runKey, type RowContext, type RowTable } from '../../src/lib/engineering/ingest/protocol';
import { planBlobs, planRows } from '../../src/lib/engineering/ingest/plan';
import { checkDocs, toAnnotation, type DocsCheckContext } from '../../src/lib/engineering/docsCheck';
import { percentile, summarizeCost, summarizeMetrics, type MetricRow, type UsageRow } from '../../src/lib/engineering/metricsSummary';
import { scoreBenchmark, type BenchmarkQuestion } from '../../src/lib/engineering/benchmark';
import { parseFrontMatter } from '../../src/lib/engineering/indexer/markdownExtractor';
import { ENGINEERING_MODULES } from '../../src/lib/engineering/moduleRegistry';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

const ROOT = resolve(__dirname, '../..');
const REPO = resolve(ROOT, '../..');
const read = (path: string) => readFileSync(join(REPO, path), 'utf8');

// One snapshot of the committed repository, shared by the tests below (about 4 s).
const built = snapshotFromGit({ root: repoRoot(), ref: 'HEAD', branch: 'main', mode: 'incremental' });
const snapshot = built.snapshot;

test.describe('ingest protocol against the real snapshot', () => {
  const ctx: RowContext = {
    runId: '11111111-1111-4111-8111-111111111111', repositoryId: '22222222-2222-4222-8222-222222222222',
    fileIdByPath: new Map(snapshot.files.map((file, index) => [file.path, `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`])),
    docIdByKey: new Map(snapshot.documents.map((doc, index) => [doc.docKey, `33333333-0000-4000-8000-${String(index).padStart(12, '0')}`])),
  };

  test('every planned batch validates and maps, and the plan carries exactly the manifest counts', () => {
    const batches = planRows(snapshot);
    const counts: Record<string, number> = {};
    for (const batch of batches) {
      const mapped = mapRows(batch.table, batch.rows, ctx);
      expect(mapped.length).toBe(batch.rows.length);
      expect(mapped.every((row) => row.run_id === ctx.runId)).toBe(true);
      counts[batch.table] = (counts[batch.table] ?? 0) + mapped.length;
    }
    expect(counts.files).toBe(snapshot.manifest.files);
    expect(counts.symbols).toBe(snapshot.manifest.symbols);
    expect(counts.relations).toBe(snapshot.manifest.relations);
    expect(counts.documents).toBe(snapshot.manifest.documents);
    expect(counts.chunks).toBe(snapshot.manifest.chunks);
    expect(counts.excluded).toBe(snapshot.manifest.excluded);
    expect(counts.modules).toBe(ENGINEERING_MODULES.length);
  });

  test('files come before everything that references a path, documents before chunks', () => {
    const order = planRows(snapshot).map((batch) => batch.table);
    const first = (table: RowTable) => order.indexOf(table);
    for (const dependent of ['symbols', 'relations', 'documents', 'chunks'] as const) expect(first('files')).toBeLessThan(first(dependent));
    expect(first('documents')).toBeLessThan(first('chunks'));
  });

  test('every request stays under the body limit', () => {
    for (const batch of planRows(snapshot)) {
      expect(Buffer.byteLength(JSON.stringify({ action: 'rows', runId: ctx.runId, table: batch.table, rows: batch.rows }), 'utf8')).toBeLessThan(INGEST_LIMITS.maxBodyBytes);
    }
    for (const blobs of planBlobs(snapshot.blobs, Object.keys(snapshot.blobs))) {
      expect(blobs.length).toBeLessThanOrEqual(INGEST_LIMITS.maxBlobsPerBatch);
      expect(Buffer.byteLength(JSON.stringify({ action: 'blobs', runId: ctx.runId, blobs }), 'utf8')).toBeLessThan(INGEST_LIMITS.maxBodyBytes);
    }
  });

  test('every blob key is the git object id of its content (the server verifies the same)', () => {
    for (const [sha, content] of Object.entries(snapshot.blobs)) if (gitBlobSha(content) !== sha) throw new Error(`blob ${sha} does not hash to its key`);
    expect(parseBlobs(planBlobs(snapshot.blobs, Object.keys(snapshot.blobs).slice(0, 5))[0])).toHaveLength(5);
  });

  test('the upload plan only needs the blobs the server reports missing', () => {
    const shas = Object.keys(snapshot.blobs);
    expect(planBlobs(snapshot.blobs, []).flat()).toEqual([]);
    expect(planBlobs(snapshot.blobs, shas.slice(0, 3)).flat().map((blob) => blob.sha).sort()).toEqual(shas.slice(0, 3).sort());
    expect(planBlobs(snapshot.blobs, ['f'.repeat(40)]).flat()).toEqual([]);
  });
});

test.describe('ingest protocol validation', () => {
  const ctx: RowContext = { runId: '11111111-1111-4111-8111-111111111111', repositoryId: '22222222-2222-4222-8222-222222222222', fileIdByPath: new Map([['a.ts', 'f1']]), docIdByKey: new Map() };
  const code = (action: () => unknown) => { try { action(); return null; } catch (error) { return error instanceof IngestError ? error.code : 'other'; } };

  test('unknown paths, kinds and shapes are rejected with a stable code that never echoes the value', () => {
    expect(code(() => mapRows('symbols', [{ path: 'secret/not-indexed.ts', name: 'x', kind: 'function', startLine: 1, endLine: 1, contentHash: 'h' }], ctx))).toBe('unknown_path');
    expect(code(() => mapRows('symbols', [{ path: 'a.ts', name: 'x', kind: 'rm -rf', startLine: 1, endLine: 1, contentHash: 'h' }], ctx))).toBe('bad_kind');
    expect(code(() => mapRows('symbols', [{ path: 'a.ts', name: 'x', kind: 'function', startLine: 5, endLine: 2, contentHash: 'h' }], ctx))).toBe('bad_end_line');
    expect(code(() => mapRows('relations', [{ fromPath: 'a.ts', kind: 'imports' }], ctx))).toBe('bad_relation_target');
    expect(code(() => mapRows('files', 'nope', ctx))).toBe('bad_rows');
    expect(code(() => mapRows('files', [], ctx))).toBe('bad_rows');
    expect(code(() => mapRows('chunks', Array.from({ length: INGEST_LIMITS.maxChunkRowsPerBatch + 1 }, () => ({})), ctx))).toBe('bad_rows');
    try { mapRows('excluded', [{ path: 'x'.repeat(600), reasonCode: 'secret_detected' }], ctx); } catch (error) { expect((error as Error).message).not.toContain('xxxx'); }
  });

  test('start, shas, blobs and manifest are strictly parsed', () => {
    expect(parseStart({ branch: 'main', commitSha: 'a'.repeat(40), mode: 'full' })).toMatchObject({ trigger: 'manual', mode: 'full' });
    expect(runKey({ commitSha: 'a'.repeat(40), mode: 'full' })).toBe(`${'a'.repeat(40)}:full`);
    for (const bad of [{ branch: 'ma in', commitSha: 'a'.repeat(40), mode: 'full' }, { branch: 'main', commitSha: 'zz', mode: 'full' }, { branch: 'main', commitSha: 'a'.repeat(40), mode: 'weird' }, { branch: 'main', commitSha: 'a'.repeat(40), mode: 'full', trigger: 'cron' }]) {
      expect(code(() => parseStart(bad))).not.toBeNull();
    }
    expect(code(() => parseShas(['nothex']))).toBe('bad_sha');
    expect(code(() => parseShas(Array.from({ length: INGEST_LIMITS.maxShasPerCall + 1 }, () => 'a'.repeat(40))))).toBe('bad_shas');
    expect(code(() => parseBlobs([{ sha: 'a'.repeat(40), content: 'x\u0000y' }]))).toBe('bad_blob');
    expect(code(() => parseBlobs([{ sha: 'a'.repeat(40), content: 'x'.repeat(600 * 1024) }]))).toBe('blob_too_large');
    expect(code(() => parseManifest({ files: 1, symbols: 1, relations: 1, documents: 1, chunks: 1, excluded: 1, checksum: 'nope' }))).toBe('bad_manifest_checksum');
  });

  test('batching respects both caps', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ i, pad: 'x'.repeat(100) }));
    expect(batchRows(rows, 10).map((batch) => batch.length)).toEqual([10, 10, 5]);
    expect(batchRows(rows, 100, 500).every((batch) => JSON.stringify(batch).length < 700)).toBe(true);
    expect(batchRows([], 10)).toEqual([]);
  });
});

test.describe('ingest surface', () => {
  test('the route checks the token before reading the body and is not an admin or tenant route', () => {
    const route = read('apps/storefront/src/app/api/internal/engineering/ingest/route.ts');
    expect(route.indexOf('ingestAuthorized(')).toBeGreaterThan(-1);
    expect(route.indexOf('ingestAuthorized(')).toBeLessThan(route.indexOf('request.text()'));
    expect(route).not.toMatch(/cookies\(|getTenant|SERVICE_ROLE/);
    expect(permissionForAdminApi('/api/internal/engineering/ingest', 'POST')).toBeNull();
    const server = read('apps/storefront/src/lib/engineering/server/ingest.ts');
    expect(server).toContain('timingSafeEqual');
    expect(server).toMatch(/expected\.length < 32\) return 'disabled'/);
    expect(server.indexOf('gitBlobSha(blob.content)')).toBeGreaterThan(-1);
    // A closed run never accepts rows or blobs, and only the default branch is ever activated.
    expect(server.match(/openRun\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(server).toContain('run?.branch !== repo.defaultBranch');
  });

  test('the workflow uses the ingest token only, never the service-role key, and skips quietly when unconfigured', () => {
    const workflow = read('.github/workflows/engineering-sync.yml');
    expect(workflow).toContain('secrets.ENGINEERING_INGEST_TOKEN');
    expect(workflow).not.toMatch(/SERVICE_ROLE|SUPABASE_/);
    expect(workflow).toContain('enabled=false');
    expect(workflow).toMatch(/concurrency:\s*\r?\n\s*group: engineering-sync\s*\r?\n\s*cancel-in-progress: false/);
    expect(workflow).toContain('node-version: 24');
    expect(workflow).toContain('--branch main');
  });

  test('CI has the docs-check job on a Node that runs the scripts, with full history', () => {
    const ci = read('.github/workflows/ci.yml');
    const job = ci.slice(ci.indexOf('engineering-docs:'));
    expect(job).toContain('fetch-depth: 0');
    expect(job).toContain('node-version: 24');
    expect(job).toContain('pnpm engineering:docs-check');
  });

  test('the scripts run under Node type stripping (no parameter properties, enums or namespaces)', () => {
    for (const file of ['apps/storefront/scripts/engineering-sync.ts', 'apps/storefront/scripts/engineering-docs-check.ts', 'apps/storefront/scripts/engineering-benchmark.ts', 'apps/storefront/scripts/engineeringGit.ts',
      'apps/storefront/src/lib/engineering/ingest/protocol.ts', 'apps/storefront/src/lib/engineering/ingest/plan.ts', 'apps/storefront/src/lib/engineering/docsCheck.ts', 'apps/storefront/src/lib/engineering/benchmark.ts']) {
      const text = read(file);
      expect(text, file).not.toMatch(/constructor\([^)]*\b(public|private|protected|readonly)\s+\w+/);
      expect(text, file).not.toMatch(/^\s*(export\s+)?(const\s+)?enum\s/m);
      expect(text, file).not.toMatch(/^\s*(export\s+)?namespace\s/m);
      expect(text, file).not.toMatch(/from '@\//);
    }
  });
});

test.describe('stale documentation check', () => {
  const base = (over: Partial<DocsCheckContext> = {}): DocsCheckContext => ({
    moduleKeys: ['alpha'], existsAtHead: () => true, changedSince: () => [], prChanged: [], ...over,
  });
  const card = (fm: Record<string, unknown>) => [{ path: 'docs/engineering/modules/alpha.md', frontMatter: { id: 'eng-module-alpha', modulo: 'alpha', stato: 'parziale', ...fm } as never }];

  test('a clean partial card passes; a module without a card or a card without front matter fails', () => {
    expect(checkDocs(card({}), base())).toEqual([]);
    expect(checkDocs([], base()).map((finding) => finding.message)).toEqual([expect.stringContaining('non ha una scheda')]);
    expect(checkDocs([{ path: 'x.md', frontMatter: null }], base()).some((finding) => finding.level === 'error')).toBe(true);
    expect(checkDocs(card({ modulo: 'ghost' }), base()).some((finding) => finding.message.includes('sconosciuto'))).toBe(true);
  });

  test('a missing monitored file is an error', () => {
    const findings = checkDocs(card({ file_monitorati: ['gone.ts', 'here.ts'] }), base({ existsAtHead: (path) => path !== 'gone.ts' }));
    expect(findings.map((finding) => finding.message)).toEqual([expect.stringContaining('gone.ts')]);
  });

  test('"verificata" needs owner, date and a known sha, and fails when a monitored file changed since', () => {
    const verified = { stato: 'verificata', owner: 'Platform Owner', data_verifica: '2026-10-30', sha_verificato: 'abcdef1', file_monitorati: ['a.ts', 'b.ts'] };
    expect(checkDocs(card(verified), base())).toEqual([]);
    expect(checkDocs(card({ ...verified, owner: undefined, data_verifica: undefined, sha_verificato: undefined }), base()).filter((finding) => finding.level === 'error')).toHaveLength(3);
    expect(checkDocs(card(verified), base({ changedSince: () => ['b.ts'] }))[0]?.message).toContain('b.ts');
    expect(checkDocs(card(verified), base({ changedSince: () => null }))[0]?.message).toContain('non è un commit noto');
  });

  test('a non-verified card only warns when the PR touches its monitored files', () => {
    const findings = checkDocs(card({ file_monitorati: ['a.ts'] }), base({ prChanged: ['a.ts', 'z.ts'] }));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.level).toBe('warning');
    expect(toAnnotation({ level: 'warning', path: 'p.md', message: 'a\nb 100%' })).toBe('::warning file=p.md::a b 100 ');
  });

  test('the real cards pass the check against the real repository', () => {
    const dir = join(REPO, 'docs/engineering/modules');
    const cards = readdirSync(dir).filter((name) => name.endsWith('.md')).map((name) => ({
      path: `docs/engineering/modules/${name}`, frontMatter: parseFrontMatter(readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n')).data,
    }));
    const findings = checkDocs(cards, { moduleKeys: ENGINEERING_MODULES.map((entry) => entry.moduleKey), existsAtHead: (path) => existsSync(join(REPO, path)), changedSince: () => [], prChanged: [] });
    expect(findings).toEqual([]);
    expect(cards).toHaveLength(10);
  });
});

test.describe('metrics and cost summaries', () => {
  const metric = (over: Partial<MetricRow>): MetricRow => ({ kind: 'ask', actor_kind: 'owner', outcome: 'ok', latency_ms: 1000, tool_calls: 2, citations: 3, dropped_citations: 0, created_at: '2026-10-30T10:00:00Z', ...over });

  test('empty input yields n.d. (null), never 0 %', () => {
    const summary = summarizeMetrics([]);
    expect(summary.answerRate).toBeNull();
    expect(summary.droppedCitationRate).toBeNull();
    expect(summary.avgToolCalls).toBeNull();
    expect(summary.latency).toEqual({ p50: null, p95: null });
    expect(summary.machineShare).toBeNull();
  });

  test('rates use the right denominators and gate-refused asks do not dilute quality', () => {
    const summary = summarizeMetrics([
      metric({}), metric({ outcome: 'no_answer', citations: 0, dropped_citations: 2 }), metric({ outcome: 'disabled', citations: 0 }), metric({ outcome: 'rate_limited' }),
      metric({ kind: 'search', outcome: 'ok', actor_kind: 'machine', latency_ms: 50, tool_calls: 0, citations: 0 }),
    ]);
    expect(summary.asks).toBe(4);
    expect(summary.searches).toBe(1);
    expect(summary.answerRate).toBe(0.5);
    expect(summary.droppedCitationRate).toBe(2 / 5);
    expect(summary.machineShare).toBe(0.2);
    expect(summary.daily).toEqual([{ day: '2026-10-30', searches: 1, asks: 4 }]);
  });

  test('percentiles are nearest-rank', () => {
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 50)).toBe(50);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95)).toBe(100);
    expect(percentile([], 50)).toBeNull();
  });

  test('cost is bucketed by UTC day, week and month and grouped by model', () => {
    const now = new Date('2026-10-30T12:00:00Z');
    const usage = (cost: number, at: string, status = 'success'): UsageRow => ({ provider: 'gemini', model: 'flash', status, input_tokens: 100, output_tokens: 10, estimated_cost_usd: cost, created_at: at });
    const cost = summarizeCost([usage(1, '2026-10-30T01:00:00Z'), usage(2, '2026-10-26T01:00:00Z'), usage(4, '2026-10-02T01:00:00Z'), usage(8, '2026-09-01T01:00:00Z', 'error')], now);
    expect(cost.today).toBe(1);
    expect(cost.last7Days).toBe(3);
    expect(cost.last30Days).toBe(7);
    expect(cost.failedCalls).toBe(1);
    expect(cost.inputTokens).toBe(400);
    expect(cost.byModel[0]).toMatchObject({ model: 'gemini/flash', calls: 4 });
  });

  test('the metrics page reads only engineering tables and never prints a question', () => {
    const page = read('apps/storefront/src/app/admin/(protected)/platform/engineering/metriche/page.tsx');
    expect(page.match(/\.from\('([a-z_]+)'\)/g)?.every((match) => match.includes('engineering_'))).toBe(true);
    expect(page).not.toMatch(/question_hash|question_text/);
  });
});

test.describe('benchmark', () => {
  const file = JSON.parse(read('docs/engineering/benchmark/questions.json')) as { questions: BenchmarkQuestion[] };
  const indexed = new Set(snapshot.files.map((entry) => entry.path));

  test('every expected source of every benchmark question exists in the real index', () => {
    expect(file.questions.length).toBeGreaterThanOrEqual(15);
    expect(new Set(file.questions.map((question) => question.id)).size).toBe(file.questions.length);
    for (const question of file.questions) {
      expect(question.question.length).toBeGreaterThan(15);
      for (const path of question.expectedPaths) expect(indexed.has(path), `${question.id} → ${path}`).toBe(true);
    }
  });

  test('scoring separates a wrong answer from "I do not know" from a failure', () => {
    const questions: BenchmarkQuestion[] = [
      { id: 'a', question: '?', expectedPaths: ['x.ts'] }, { id: 'b', question: '?', expectedPaths: ['x.ts', 'y.ts'] }, { id: 'c', question: '?', expectedPaths: ['x.ts'] },
      { id: 'd', question: '?', expectedPaths: ['x.ts'] }, { id: 'e', question: '?', expectedPaths: ['x.ts'] },
    ];
    const report = scoreBenchmark(questions, [
      { id: 'a', state: 'answered', citedPaths: ['x.ts'], latencyMs: 1000 }, { id: 'b', state: 'answered', citedPaths: ['x.ts'], latencyMs: 3000 },
      { id: 'c', state: 'answered', citedPaths: ['z.ts'], latencyMs: 2000 }, { id: 'd', state: 'no_answer', citedPaths: [], latencyMs: 2000 }, { id: 'e', state: 'disabled', citedPaths: [], latencyMs: 5 },
    ]);
    expect(report).toMatchObject({ answered: 3, hit: 2, complete: 1, offTarget: ['c'], unanswered: ['d'], failed: ['e'] });
    expect(report.hitRate).toBe(2 / 4);
    expect(report.avgLatencyMs).toBe(2000);
    expect(scoreBenchmark(questions, []).hitRate).toBeNull();
  });
});

test.describe('index quality on the real repository', () => {
  const symbol = (path: string, name: string) => snapshot.symbols.find((entry) => entry.path === path && entry.name === name);
  const relation = (fromPath: string, kind: string, targetRef: string) => snapshot.relations.some((entry) => entry.fromPath === fromPath && entry.kind === kind && entry.targetRef === targetRef);

  test('known symbols, RPC calls, table uses and object definitions are found', () => {
    expect(symbol('apps/storefront/src/lib/checkout/validateCheckoutItems.ts', 'validateCheckoutItems')).toMatchObject({ kind: 'function', exported: true });
    expect(symbol('apps/storefront/src/lib/purchaseQuantityRules.ts', 'computeQuantityRuleState')?.exported).toBe(true);
    expect(relation('apps/storefront/src/lib/orders/convertCheckoutSessionToOrder.ts', 'calls_rpc', 'convert_checkout_session_to_order')).toBe(true);
    expect(relation('apps/storefront/src/lib/engineering/server/repository.ts', 'uses_table', 'engineering_files')).toBe(true);
    expect(relation('supabase/migrations/175_engineering_hub.sql', 'defines_object', 'engineering_blobs')).toBe(true);
    expect(snapshot.relations.some((entry) => entry.fromPath === 'apps/storefront/src/app/api/checkout/route.ts' && entry.kind === 'handles_route')).toBe(true);
  });

  test('modules, documents and tests are attached', () => {
    const module = (path: string) => snapshot.files.find((entry) => entry.path === path)?.moduleKey;
    expect(module('apps/storefront/src/lib/checkout/validateCheckoutItems.ts')).toBe('payments-stripe');
    expect(module('apps/storefront/src/lib/gestion/featureGate.ts')).toBe('gestion');
    expect(snapshot.documents.filter((doc) => doc.path.startsWith('docs/engineering/modules/')).length).toBe(10);
    expect(snapshot.relations.some((entry) => entry.kind === 'tests' && entry.toPath === 'apps/storefront/src/lib/engineering/search/contract.ts')).toBe(true);
  });

  test('no excluded file has a blob, and the index never stores a provider secret', () => {
    const excluded = new Set(snapshot.excluded.map((entry) => entry.path));
    expect(snapshot.files.some((entry) => excluded.has(entry.path))).toBe(false);
    const joined = Object.values(snapshot.blobs).join('\n');
    expect(joined).not.toMatch(/sk_live_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/]{40,}/);
  });
});
