import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { gitBlobSha } from '../indexer/buildSnapshot';
import {
  INGEST_ACTIONS, IngestError, ROW_TABLES, mapRows, parseBlobs, parseManifest, parseShas, parseStart, parseUuid, runKey,
  type IngestAction, type RowTable,
} from '../ingest/protocol';
import { ENGINEERING_REPOSITORY } from './activeRun';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
const db = (): Db => createServiceClient();

/** Constant-time comparison of the bearer token with ENGINEERING_INGEST_TOKEN. Unset or short token = disabled. */
export function ingestAuthorized(header: string | null): 'ok' | 'disabled' | 'denied' {
  const expected = process.env.ENGINEERING_INGEST_TOKEN ?? '';
  if (expected.length < 32) return 'disabled';
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!match?.[1]) return 'denied';
  const a = createHash('sha256').update(match[1]).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b) ? 'ok' : 'denied';
}

async function repository(): Promise<{ id: string; defaultBranch: string }> {
  const { data, error } = await db().from('engineering_repositories').select('id, default_branch').eq('slug', ENGINEERING_REPOSITORY).maybeSingle();
  if (error || !data) throw new IngestError('repository_unavailable', 503);
  return { id: data.id, defaultBranch: data.default_branch };
}

/** A run must belong to the repository and still be writable (`running`) before any batch is accepted. */
async function openRun(runId: string, repositoryId: string): Promise<void> {
  const { data, error } = await db().from('engineering_index_runs').select('status').eq('id', runId).eq('repository_id', repositoryId).maybeSingle();
  if (error) throw new IngestError('run_unavailable', 503);
  if (!data) throw new IngestError('run_unknown', 404);
  if (data.status !== 'running') throw new IngestError('run_closed', 409);
}

async function fileIdsByPath(runId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let from = 0; from < 40_000; from += 1000) {
    const { data, error } = await db().from('engineering_files').select('id, path').eq('run_id', runId).order('path').range(from, from + 999);
    if (error) throw new IngestError('read_failed', 503);
    for (const row of (data ?? []) as Array<{ id: string; path: string }>) map.set(row.path, row.id);
    if ((data ?? []).length < 1000) break;
  }
  return map;
}

function rpcError(error: { message?: string }): IngestError {
  const message = error.message ?? '';
  const known = /engineering_[a-z_]+/.exec(message)?.[0];
  if (known === 'engineering_run_in_progress') return new IngestError(known, 409);
  if (known === 'engineering_branch_not_activatable' || known === 'engineering_run_not_staged' || known === 'engineering_run_closed') return new IngestError(known, 409);
  return new IngestError('database_error', 500);
}

export async function handleIngest(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const action = body.action;
  if (typeof action !== 'string' || !(INGEST_ACTIONS as readonly string[]).includes(action)) throw new IngestError('bad_action', 400);
  const repo = await repository();
  const client = db();

  switch (action as IngestAction) {
    case 'start': {
      const input = parseStart(body);
      const { data, error } = await client.rpc('engineering_start_run', {
        p_repo: ENGINEERING_REPOSITORY, p_branch: input.branch, p_sha: input.commitSha, p_mode: input.mode, p_run_key: runKey(input), p_trigger: input.trigger,
      });
      if (error) throw rpcError(error);
      const run = Array.isArray(data) ? data[0] : data;
      return { runId: run.id, status: run.status, repositoryId: repo.id, defaultBranch: repo.defaultBranch };
    }
    case 'missing': {
      const { data, error } = await client.rpc('engineering_missing_blobs', { p_repo: repo.id, p_shas: parseShas(body.shas) });
      if (error) throw rpcError(error);
      return { missing: data ?? [] };
    }
    case 'blobs': {
      await openRun(parseUuid(body.runId), repo.id);
      const blobs = parseBlobs(body.blobs);
      // The key of a blob is its git object id: a content that does not hash to it is never stored.
      for (const blob of blobs) if (gitBlobSha(blob.content) !== blob.sha) throw new IngestError('blob_sha_mismatch');
      const { error } = await client.from('engineering_blobs').upsert(
        blobs.map((blob) => ({ repository_id: repo.id, blob_sha: blob.sha, content: blob.content, size_bytes: Buffer.byteLength(blob.content, 'utf8') })),
        { onConflict: 'repository_id,blob_sha', ignoreDuplicates: true },
      );
      if (error) throw new IngestError('database_error', 500);
      return { stored: blobs.length };
    }
    case 'rows': {
      const runId = parseUuid(body.runId);
      await openRun(runId, repo.id);
      const table = body.table as RowTable;
      if (!(ROW_TABLES as readonly string[]).includes(table)) throw new IngestError('bad_table', 400);
      const needsFiles = table !== 'modules' && table !== 'files' && table !== 'excluded';
      const docIdByKey = new Map<string, string>();
      if (table === 'chunks') {
        const { data } = await client.from('engineering_documents').select('id, doc_key').eq('run_id', runId).limit(5000);
        for (const row of (data ?? []) as Array<{ id: string; doc_key: string }>) docIdByKey.set(row.doc_key, row.id);
      }
      const rows = mapRows(table, body.rows, { runId, repositoryId: repo.id, fileIdByPath: needsFiles ? await fileIdsByPath(runId) : new Map(), docIdByKey });
      const target = { modules: 'engineering_modules', files: 'engineering_files', excluded: 'engineering_excluded_files', symbols: 'engineering_symbols', relations: 'engineering_relations', documents: 'engineering_documents', chunks: 'engineering_chunks' }[table];
      const { error } = await client.from(target).insert(rows);
      if (error) throw new IngestError(error.code === '23503' ? 'missing_blob_or_reference' : error.code === '23505' ? 'duplicate_row' : 'database_error', error.code === '23505' ? 409 : 422);
      return { inserted: rows.length };
    }
    case 'complete': {
      const runId = parseUuid(body.runId);
      const manifest = parseManifest(body.manifest);
      const { data: staged, error } = await client.rpc('engineering_finalize_run', { p_run: runId, p_manifest: manifest });
      if (error) throw rpcError(error);
      if (staged !== 'staged') return { status: 'failed', code: 'manifest_mismatch' };
      // Only the default branch can become the index the Hub reads; a PR/branch run stays `staged`.
      const { data: run } = await client.from('engineering_index_runs').select('branch').eq('id', runId).maybeSingle();
      if (run?.branch !== repo.defaultBranch) return { status: 'staged' };
      const { error: activateError } = await client.rpc('engineering_activate_run', { p_run: runId, p_actor: 'github-actions' });
      if (activateError) throw rpcError(activateError);
      await client.rpc('engineering_purge', { p_repo: repo.id, p_keep: 3 });
      return { status: 'active' };
    }
    case 'fail': {
      const runId = parseUuid(body.runId);
      const code = typeof body.code === 'string' && /^[a-z0-9_]{2,60}$/.test(body.code) ? body.code : 'client_failed';
      const { error } = await client.rpc('engineering_fail_run', { p_run: runId, p_code: code });
      if (error) throw rpcError(error);
      return { status: 'failed' };
    }
  }
}
