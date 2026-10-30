/**
 * Engineering Hub ingest protocol (pure): validation and row mapping of the batches a CI job
 * uploads. No imports from Next or Supabase, so the same contract is tested without a database.
 *
 *   start -> missing -> blobs* -> rows(modules, files, excluded, symbols, relations, documents, chunks)* -> complete
 *
 * The caller authenticates with a dedicated token (never the service-role key). Every batch is
 * bounded; the database enforces the final truth (run open, manifest, checksum, activation).
 */
import { CHUNK_KINDS, FILE_KINDS, FILE_LANGUAGES, LIMITS, RELATION_KINDS, SYMBOL_KINDS, DOC_REVIEW_STATUSES } from '../domain';

export const INGEST_ACTIONS = ['start', 'missing', 'blobs', 'rows', 'complete', 'fail'] as const;
export type IngestAction = (typeof INGEST_ACTIONS)[number];

export const ROW_TABLES = ['modules', 'files', 'excluded', 'symbols', 'relations', 'documents', 'chunks'] as const;
export type RowTable = (typeof ROW_TABLES)[number];

/** Per-request bounds (the platform body limit is 4.5 MB; stay well under it). */
export const INGEST_LIMITS = {
  maxBodyBytes: 3_500_000,
  maxBlobsPerBatch: 400,
  maxShasPerCall: 5000,
  maxRowsPerBatch: 3000,
  maxChunkRowsPerBatch: 500,
  triggers: ['manual', 'push', 'schedule', 'pull_request'],
} as const;

// No parameter properties: this file also runs under Node type stripping (engineering:sync).
export class IngestError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 422) { super(code); this.name = 'IngestError'; this.code = code; this.status = status; }
}

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown, max: number, field: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new IngestError(`bad_${field}`);
  return value;
};
const optStr = (value: unknown, max: number, field: string): string | null => (value === null || value === undefined ? null : str(value, max, field));
const int = (value: unknown, field: string, min = 0, max = 2_000_000_000): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new IngestError(`bad_${field}`);
  return value;
};
const optInt = (value: unknown, field: string): number | null => (value === null || value === undefined ? null : int(value, field, 1));
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new IngestError(`bad_${field}`);
  return value as T;
};
const SHA1 = /^[0-9a-f]{40}$/;
const sha = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !SHA1.test(value)) throw new IngestError(`bad_${field}`);
  return value;
};

export interface StartInput { branch: string; commitSha: string; mode: 'full' | 'incremental'; trigger: (typeof INGEST_LIMITS.triggers)[number] }

export function parseStart(body: Obj): StartInput {
  const branch = str(body.branch, 100, 'branch');
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new IngestError('bad_branch');
  return {
    branch, commitSha: sha(body.commitSha, 'commit_sha'),
    mode: oneOf(body.mode, ['full', 'incremental'] as const, 'mode'),
    trigger: oneOf(body.trigger ?? 'manual', INGEST_LIMITS.triggers, 'trigger'),
  };
}

export const runKey = (input: Pick<StartInput, 'commitSha' | 'mode'>) => `${input.commitSha}:${input.mode}`;

export function parseUuid(value: unknown, field = 'run_id'): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new IngestError(`bad_${field}`);
  return value;
}

export function parseShas(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > INGEST_LIMITS.maxShasPerCall) throw new IngestError('bad_shas');
  return value.map((entry) => sha(entry, 'sha'));
}

export interface BlobInput { sha: string; content: string }

export function parseBlobs(value: unknown): BlobInput[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > INGEST_LIMITS.maxBlobsPerBatch) throw new IngestError('bad_blobs');
  return value.map((entry) => {
    if (!isObj(entry) || typeof entry.content !== 'string' || entry.content.includes('\u0000')) throw new IngestError('bad_blob');
    if (Buffer.byteLength(entry.content, 'utf8') > LIMITS.maxFileBytes) throw new IngestError('blob_too_large');
    return { sha: sha(entry.sha, 'blob_sha'), content: entry.content };
  });
}

export interface RowContext {
  runId: string;
  repositoryId: string;
  fileIdByPath: Map<string, string>;
  docIdByKey: Map<string, string>;
}

const fileId = (ctx: RowContext, path: unknown, field: string): string => {
  const id = typeof path === 'string' ? ctx.fileIdByPath.get(path) : undefined;
  if (!id) throw new IngestError(`unknown_${field}`);
  return id;
};

/** Validates and maps one batch to database rows. Throws IngestError with a stable code, never the offending value. */
export function mapRows(table: RowTable, rows: unknown, ctx: RowContext): Obj[] {
  const limit = table === 'chunks' ? INGEST_LIMITS.maxChunkRowsPerBatch : INGEST_LIMITS.maxRowsPerBatch;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > limit) throw new IngestError('bad_rows');
  return rows.map((raw): Obj => {
    if (!isObj(raw)) throw new IngestError('bad_row');
    switch (table) {
      case 'modules':
        return {
          run_id: ctx.runId, module_key: str(raw.moduleKey, 60, 'module_key'), title: str(raw.title, 200, 'title'), category: str(raw.category, 100, 'category'),
          summary: str(raw.summary, 1000, 'summary'), path_globs: Array.isArray(raw.pathGlobs) ? raw.pathGlobs.map((glob) => str(glob, 300, 'glob')) : (() => { throw new IngestError('bad_globs'); })(),
          position: int(raw.position, 'position', 0, 10_000),
        };
      case 'files':
        return {
          run_id: ctx.runId, repository_id: ctx.repositoryId, path: str(raw.path, LIMITS.maxPathLength, 'path'),
          kind: oneOf(raw.kind, FILE_KINDS, 'kind'), language: oneOf(raw.language, FILE_LANGUAGES, 'language'), blob_sha: sha(raw.blobSha, 'blob_sha'),
          size_bytes: int(raw.sizeBytes, 'size'), line_count: int(raw.lineCount, 'lines'), module_key: optStr(raw.moduleKey, 60, 'module_key'),
        };
      case 'excluded':
        return { run_id: ctx.runId, path: str(raw.path, LIMITS.maxPathLength, 'path'), reason_code: str(raw.reasonCode, 60, 'reason') };
      case 'symbols': {
        const start = int(raw.startLine, 'start_line', 1);
        return {
          run_id: ctx.runId, file_id: fileId(ctx, raw.path, 'path'), name: str(raw.name, LIMITS.maxSymbolName, 'name'), kind: oneOf(raw.kind, SYMBOL_KINDS, 'kind'),
          exported: raw.exported === true, signature: optStr(raw.signature, LIMITS.maxSignature, 'signature'), start_line: start,
          end_line: int(raw.endLine, 'end_line', start), content_hash: str(raw.contentHash, 128, 'hash'), parent_name: optStr(raw.parentName, LIMITS.maxSymbolName, 'parent'),
        };
      }
      case 'relations': {
        const toPath = optStr(raw.toPath, LIMITS.maxPathLength, 'to_path');
        const targetRef = optStr(raw.targetRef, 300, 'target_ref');
        if (!toPath && !targetRef) throw new IngestError('bad_relation_target');
        return {
          run_id: ctx.runId, from_file_id: fileId(ctx, raw.fromPath, 'from_path'), to_file_id: toPath ? fileId(ctx, toPath, 'to_path') : null,
          kind: oneOf(raw.kind, RELATION_KINDS, 'kind'), target_ref: targetRef, evidence_line: optInt(raw.evidenceLine, 'evidence_line'),
        };
      }
      case 'documents':
        return {
          run_id: ctx.runId, file_id: fileId(ctx, raw.path, 'path'), doc_key: str(raw.docKey, 200, 'doc_key'), title: str(raw.title, 300, 'title'),
          module_key: optStr(raw.moduleKey, 60, 'module_key'), category: optStr(raw.category, 100, 'category'),
          review_status: oneOf(raw.reviewStatus, DOC_REVIEW_STATUSES, 'review_status'),
          verified_sha: raw.verifiedSha === null || raw.verifiedSha === undefined ? null : (typeof raw.verifiedSha === 'string' && /^[0-9a-f]{7,40}$/.test(raw.verifiedSha) ? raw.verifiedSha : (() => { throw new IngestError('bad_verified_sha'); })()),
          owner: optStr(raw.owner, 200, 'owner'),
          verified_on: raw.verifiedOn === null || raw.verifiedOn === undefined ? null : (typeof raw.verifiedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.verifiedOn) ? raw.verifiedOn : (() => { throw new IngestError('bad_verified_on'); })()),
          monitored_files: Array.isArray(raw.monitoredFiles) ? raw.monitoredFiles.slice(0, 100).map((file) => str(file, LIMITS.maxPathLength, 'monitored')) : [],
        };
      case 'chunks': {
        const start = int(raw.startLine, 'start_line', 1);
        const docKey = optStr(raw.docKey, 200, 'doc_key');
        return {
          run_id: ctx.runId, file_id: fileId(ctx, raw.path, 'path'), symbol_id: null, document_id: docKey ? ctx.docIdByKey.get(docKey) ?? null : null,
          kind: oneOf(raw.kind, CHUNK_KINDS, 'kind'), title: str(raw.title, 400, 'title'), body: typeof raw.body === 'string' && raw.body.length <= LIMITS.maxChunkBody ? raw.body : (() => { throw new IngestError('bad_body'); })(),
          start_line: start, end_line: int(raw.endLine, 'end_line', start),
        };
      }
    }
  });
}

export function parseManifest(value: unknown) {
  if (!isObj(value)) throw new IngestError('bad_manifest');
  const out: Record<string, number | string> = {};
  for (const key of ['files', 'symbols', 'relations', 'documents', 'chunks', 'excluded'] as const) out[key] = int(value[key], `manifest_${key}`);
  if (typeof value.checksum !== 'string' || !/^[0-9a-f]{32}$/.test(value.checksum)) throw new IngestError('bad_manifest_checksum');
  out.checksum = value.checksum;
  return out;
}

/** Splits rows into batches under both a row cap and an approximate byte cap. */
export function batchRows<T>(rows: T[], maxRows: number, maxBytes = 2_500_000): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length + 1;
    if (current.length > 0 && (current.length >= maxRows || bytes + size > maxBytes)) { batches.push(current); current = []; bytes = 0; }
    current.push(row);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}
