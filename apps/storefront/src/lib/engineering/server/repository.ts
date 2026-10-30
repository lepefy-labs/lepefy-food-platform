import 'server-only';
import { cache } from 'react';
import { createServiceClient } from '@/lib/supabase/server';
import type { FileKind, IndexedModule, RelationKind, SymbolKind } from '../domain';
import type { DocumentRow, FileRow, ImportEdge } from '../explorer';

/**
 * Reads of the ACTIVE run only (the caller passes the run id obtained from getActiveRun()).
 * Tables are read flat and joined in memory: no PostgREST embeds, so a renamed constraint
 * cannot break a page. Every query is scoped by run_id; the Hub has no tenant.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
const db = (): Db => createServiceClient();

const PAGE = 1000;
const MAX_ROWS = 40_000;

async function pagedRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

export const loadFiles = cache(async (runId: string): Promise<FileRow[]> => {
  const { rows } = await pagedRows<{ id: string; path: string; kind: FileKind; module_key: string | null; size_bytes: number; line_count: number }>(
    (from, to) => db().from('engineering_files').select('id, path, kind, module_key, size_bytes, line_count').eq('run_id', runId).order('path').range(from, to),
  );
  return rows.map((row) => ({ id: row.id, path: row.path, kind: row.kind, moduleKey: row.module_key, sizeBytes: row.size_bytes, lineCount: row.line_count }));
});

export const loadDocuments = cache(async (runId: string): Promise<DocumentRow[]> => {
  const { data, error } = await db().from('engineering_documents')
    .select('doc_key, title, module_key, review_status, verified_sha, file_id').eq('run_id', runId).order('doc_key').limit(2000);
  if (error) throw error;
  const files = await loadFiles(runId);
  const pathById = new Map(files.map((file) => [file.id, file.path]));
  return ((data ?? []) as Array<{ doc_key: string; title: string; module_key: string | null; review_status: DocumentRow['reviewStatus']; verified_sha: string | null; file_id: string }>)
    .map((row) => ({ docKey: row.doc_key, title: row.title, path: pathById.get(row.file_id) ?? '', moduleKey: row.module_key, reviewStatus: row.review_status, verifiedSha: row.verified_sha }));
});

export const loadModules = cache(async (runId: string): Promise<IndexedModule[]> => {
  const { data, error } = await db().from('engineering_modules')
    .select('module_key, title, category, summary, path_globs, position').eq('run_id', runId).order('position');
  if (error) throw error;
  return ((data ?? []) as Array<{ module_key: string; title: string; category: string; summary: string; path_globs: string[]; position: number }>)
    .map((row) => ({ moduleKey: row.module_key, title: row.title, category: row.category, summary: row.summary, pathGlobs: row.path_globs, position: row.position }));
});

export const loadImportEdges = cache(async (runId: string): Promise<{ edges: ImportEdge[]; truncated: boolean }> => {
  const { rows, truncated } = await pagedRows<{ from_file_id: string; to_file_id: string }>(
    (from, to) => db().from('engineering_relations').select('from_file_id, to_file_id').eq('run_id', runId).eq('kind', 'imports').not('to_file_id', 'is', null).range(from, to),
  );
  return { edges: rows.map((row) => ({ fromFileId: row.from_file_id, toFileId: row.to_file_id })), truncated };
});

export interface SymbolRow {
  name: string;
  kind: SymbolKind;
  exported: boolean;
  signature: string | null;
  startLine: number;
  endLine: number;
  parentName: string | null;
}

export async function loadFileSymbols(runId: string, fileId: string): Promise<SymbolRow[]> {
  const { data, error } = await db().from('engineering_symbols')
    .select('name, kind, exported, signature, start_line, end_line, parent_name').eq('run_id', runId).eq('file_id', fileId).order('start_line').limit(1000);
  if (error) throw error;
  return ((data ?? []) as Array<{ name: string; kind: SymbolKind; exported: boolean; signature: string | null; start_line: number; end_line: number; parent_name: string | null }>)
    .map((row) => ({ name: row.name, kind: row.kind, exported: row.exported, signature: row.signature, startLine: row.start_line, endLine: row.end_line, parentName: row.parent_name }));
}

export interface RelationRow {
  kind: RelationKind;
  /** Other end when it is a repository file. */
  otherFileId: string | null;
  targetRef: string | null;
  evidenceLine: number | null;
}

/** Relations leaving the file (`out`) and pointing at it (`in`). */
export async function loadFileRelations(runId: string, fileId: string): Promise<{ out: RelationRow[]; in: RelationRow[] }> {
  const client = db();
  const [outgoing, incoming] = await Promise.all([
    client.from('engineering_relations').select('kind, to_file_id, target_ref, evidence_line').eq('run_id', runId).eq('from_file_id', fileId).limit(1000),
    client.from('engineering_relations').select('kind, from_file_id, evidence_line').eq('run_id', runId).eq('to_file_id', fileId).limit(1000),
  ]);
  if (outgoing.error) throw outgoing.error;
  if (incoming.error) throw incoming.error;
  return {
    out: ((outgoing.data ?? []) as Array<{ kind: RelationKind; to_file_id: string | null; target_ref: string | null; evidence_line: number | null }>)
      .map((row) => ({ kind: row.kind, otherFileId: row.to_file_id, targetRef: row.target_ref, evidenceLine: row.evidence_line })),
    in: ((incoming.data ?? []) as Array<{ kind: RelationKind; from_file_id: string; evidence_line: number | null }>)
      .map((row) => ({ kind: row.kind, otherFileId: row.from_file_id, targetRef: null, evidenceLine: row.evidence_line })),
  };
}

/** Tables, RPCs and API routes a set of files demonstrably use, with the number of files per name. */
export async function loadModuleReferences(runId: string, fileIds: string[]): Promise<Array<{ kind: RelationKind; targetRef: string; files: number }>> {
  if (fileIds.length === 0) return [];
  const ids = new Set(fileIds);
  const { rows } = await pagedRows<{ from_file_id: string; kind: RelationKind; target_ref: string }>(
    (from, to) => db().from('engineering_relations').select('from_file_id, kind, target_ref').eq('run_id', runId).in('kind', ['uses_table', 'calls_rpc', 'calls_api', 'defines_object']).not('target_ref', 'is', null).range(from, to),
  );
  const perName = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!ids.has(row.from_file_id)) continue;
    const key = `${row.kind}\u0000${row.target_ref}`;
    const set = perName.get(key) ?? new Set<string>();
    set.add(row.from_file_id);
    perName.set(key, set);
  }
  return [...perName.entries()].map(([key, set]) => {
    const [kind = 'uses_table', targetRef = ''] = key.split('\u0000');
    return { kind: kind as RelationKind, targetRef, files: set.size };
  }).sort((a, b) => b.files - a.files || (a.targetRef < b.targetRef ? -1 : 1));
}

export async function loadExcludedSummary(runId: string): Promise<Array<{ reason: string; count: number }>> {
  const { rows } = await pagedRows<{ reason_code: string }>(
    (from, to) => db().from('engineering_excluded_files').select('reason_code').eq('run_id', runId).range(from, to),
  );
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.reason_code, (counts.get(row.reason_code) ?? 0) + 1);
  return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

/** Source text of a file at the indexed commit. Excluded files have no blob and are never returned. */
export async function loadFileSource(repositoryId: string, runId: string, path: string): Promise<{ file: FileRow; content: string } | null> {
  const client = db();
  const { data: file, error } = await client.from('engineering_files')
    .select('id, path, kind, module_key, size_bytes, line_count, blob_sha').eq('run_id', runId).eq('path', path).maybeSingle();
  if (error) throw error;
  if (!file) return null;
  const { data: blob, error: blobError } = await client.from('engineering_blobs')
    .select('content').eq('repository_id', repositoryId).eq('blob_sha', file.blob_sha).maybeSingle();
  if (blobError) throw blobError;
  if (!blob) return null;
  return {
    file: { id: file.id, path: file.path, kind: file.kind, moduleKey: file.module_key, sizeBytes: file.size_bytes, lineCount: file.line_count },
    content: blob.content as string,
  };
}
