/** Upload plan of a snapshot (pure): the ordered row batches and blob batches the sync job sends. */
import type { IndexSnapshot } from '../domain';
import { INGEST_LIMITS, batchRows, type RowTable } from './protocol';

export interface RowBatch { table: RowTable; rows: unknown[] }

/** Order matters: files before anything that references a path, documents before their chunks. */
export function planRows(snapshot: IndexSnapshot): RowBatch[] {
  const tables: Array<[RowTable, unknown[], number]> = [
    ['modules', snapshot.modules, INGEST_LIMITS.maxRowsPerBatch],
    ['files', snapshot.files, 1500],
    ['excluded', snapshot.excluded, INGEST_LIMITS.maxRowsPerBatch],
    ['symbols', snapshot.symbols, 1500],
    ['relations', snapshot.relations, INGEST_LIMITS.maxRowsPerBatch],
    ['documents', snapshot.documents, 500],
    ['chunks', snapshot.chunks, INGEST_LIMITS.maxChunkRowsPerBatch],
  ];
  const batches: RowBatch[] = [];
  for (const [table, rows, cap] of tables) for (const chunk of batchRows(rows, cap)) batches.push({ table, rows: chunk });
  return batches;
}

export function planBlobs(blobs: Record<string, string>, shas: string[]): Array<Array<{ sha: string; content: string }>> {
  const entries = shas.filter((sha) => sha in blobs).sort().map((sha) => ({ sha, content: blobs[sha] as string }));
  return batchRows(entries, INGEST_LIMITS.maxBlobsPerBatch);
}
