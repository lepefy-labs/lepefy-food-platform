/**
 * Engineering Hub: build the snapshot of a ref and upload it to the Hub (docs/engineering/RUNBOOK.md).
 *
 *   pnpm engineering:sync [--ref HEAD] [--branch main] [--mode incremental|full] [--trigger push|schedule|manual] [--dry-run]
 *
 * Environment (never the service-role key):
 *   ENGINEERING_INGEST_URL    origin of the deployment, e.g. https://shop.chloefood.com
 *   ENGINEERING_INGEST_TOKEN  bearer of POST /api/internal/engineering/ingest
 *
 * Idempotent: the run key is "<sha>:<mode>", so a retry resumes or reports the same run. If a step
 * fails for good the run is closed as failed and the previous active index stays the one in use.
 */
import { repoRoot, snapshotFromGit } from './engineeringGit';
import { planBlobs, planRows } from '../src/lib/engineering/ingest/plan';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return (index !== -1 ? process.argv[index + 1] : undefined) || fallback;
}

const branch = arg('branch', 'main');
const mode = arg('mode', 'incremental') === 'full' ? 'full' : 'incremental';
const trigger = arg('trigger', 'manual');
const dryRun = process.argv.includes('--dry-run');
const started = Date.now();

const { commitSha, snapshot } = snapshotFromGit({ root: repoRoot(), ref: arg('ref', 'HEAD'), branch, mode });
const rowBatches = planRows(snapshot);
const log = (message: string) => console.log(`[engineering-sync] ${message}`);
log(`${commitSha.slice(0, 8)} ${branch} ${mode}: ${snapshot.manifest.files} files, ${snapshot.manifest.symbols} symbols, ${snapshot.manifest.relations} relations, ${snapshot.manifest.chunks} chunks, ${snapshot.manifest.excluded} excluded, ${rowBatches.length} row batches`);

if (dryRun) {
  log('dry run: nothing was sent');
  process.exit(0);
}

const base = (process.env.ENGINEERING_INGEST_URL ?? '').replace(/\/+$/, '');
const token = process.env.ENGINEERING_INGEST_TOKEN ?? '';
if (!/^https:\/\/[^/\s]+$/.test(base) || token.length < 32) {
  console.error('[engineering-sync] ENGINEERING_INGEST_URL (https origin) and ENGINEERING_INGEST_TOKEN are required');
  process.exit(2);
}

class HttpFailure extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(`${status} ${code}`); this.status = status; this.code = code; }
}

async function call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const delays = [1000, 3000, 9000];
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/internal/engineering/ingest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok) return payload;
      const failure = new HttpFailure(response.status, String(payload.error ?? 'unknown'));
      // Only transient failures are retried; a 4xx (bad batch, closed run, wrong token) will not get better.
      if (response.status < 500 && response.status !== 429) throw failure;
      throw Object.assign(failure, { transient: true });
    } catch (error) {
      const transient = !(error instanceof HttpFailure) || (error as { transient?: boolean }).transient === true;
      if (!transient || attempt >= delays.length) throw error;
      log(`transient failure (${(error as Error).message}), retry ${attempt + 1}/${delays.length}`);
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

let runId: string | null = null;
try {
  const start = await call({ action: 'start', branch, commitSha, mode, trigger });
  runId = String(start.runId);
  if (start.status !== 'running') {
    log(`run ${runId} is already ${start.status}: nothing to upload`);
    process.exit(0);
  }

  const allShas = Object.keys(snapshot.blobs);
  let toSend = allShas;
  if (mode === 'incremental') {
    const missing: string[] = [];
    for (let i = 0; i < allShas.length; i += 5000) {
      const result = await call({ action: 'missing', shas: allShas.slice(i, i + 5000) });
      missing.push(...(result.missing as string[]));
    }
    toSend = missing;
  }
  const blobBatches = planBlobs(snapshot.blobs, toSend);
  log(`${toSend.length}/${allShas.length} blobs to upload in ${blobBatches.length} batches`);
  for (const blobs of blobBatches) await call({ action: 'blobs', runId, blobs });

  let done = 0;
  for (const batch of rowBatches) {
    await call({ action: 'rows', runId, table: batch.table, rows: batch.rows });
    done += 1;
    if (done % 10 === 0 || done === rowBatches.length) log(`rows ${done}/${rowBatches.length}`);
  }

  const result = await call({ action: 'complete', runId, manifest: snapshot.manifest });
  log(`run ${runId}: ${String(result.status)} in ${Math.round((Date.now() - started) / 1000)}s`);
  if (result.status === 'failed') process.exit(1);
} catch (error) {
  console.error(`[engineering-sync] failed: ${(error as Error).message}`);
  if (runId) {
    try { await call({ action: 'fail', runId, code: 'client_failed' }); } catch { /* the 30-minute timeout closes it anyway */ }
  }
  process.exit(1);
}
