import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { getActiveRun } from './activeRun';
import { loadFiles } from './repository';
import {
  SEARCH_KINDS, SEARCH_LIMITS, buildTsQuery, escapeLike, hitKey, makeSnippet, mergeHits, scoreHit, validateQuery,
  type SearchHit, type SearchKind, type SearchOutcome, type SearchRequest, type SearchStage,
} from '../search/contract';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
const LIMIT = SEARCH_LIMITS.perSourceLimit;

function stagePattern(stage: 'exact' | 'prefix' | 'fuzzy', query: string): string {
  const escaped = escapeLike(query);
  return stage === 'exact' ? escaped : stage === 'prefix' ? `${escaped}%` : `%${escaped}%`;
}

/**
 * The single search entry point (UI, HTTP API, and the AI tools of unit C). Reads only the
 * active run; an index that is missing, empty or unreadable is reported as such, never as
 * "no results".
 */
export async function searchEngineering(request: SearchRequest): Promise<SearchOutcome> {
  const checked = validateQuery(request.query);
  if (!checked.ok) return { state: 'invalid', reason: checked.reason };
  const query = checked.query;

  const active = await getActiveRun();
  if (active.state === 'unavailable') return { state: 'unavailable' };
  if (active.state === 'empty') return { state: 'empty_index' };
  const runId = active.run.runId;

  const kinds = new Set<SearchKind>((request.kinds?.length ? request.kinds : SEARCH_KINDS).filter((kind) => (SEARCH_KINDS as readonly string[]).includes(kind)));
  const moduleKey = request.moduleKey || null;

  try {
    const db = createServiceClient() as Db;
    const files = await loadFiles(runId);
    const fileById = new Map(files.map((file) => [file.id, file]));
    const inModule = (moduleOfFile: string | null) => !moduleKey || moduleOfFile === moduleKey;
    const sources: Array<Promise<SearchHit[]>> = [];

    if (kinds.has('symbol')) {
      for (const stage of ['exact', 'prefix', 'fuzzy'] as const) {
        sources.push((async () => {
          const { data, error } = await db.from('engineering_symbols')
            .select('file_id, name, kind, exported, signature, start_line, end_line')
            .eq('run_id', runId).ilike('name', stagePattern(stage, query)).limit(LIMIT * 4);
          if (error) throw error;
          const hits: SearchHit[] = [];
          for (const row of (data ?? []) as Array<{ file_id: string; name: string; kind: string; exported: boolean; signature: string | null; start_line: number; end_line: number }>) {
            const file = fileById.get(row.file_id);
            if (!file || !inModule(file.moduleKey)) continue;
            hits.push({
              kind: 'symbol', stage, key: hitKey('symbol', file.path, row.name, row.start_line),
              score: scoreHit({ stage, kind: 'symbol', exported: row.exported, isTest: file.kind === 'test' }),
              title: row.name, path: file.path, startLine: row.start_line, endLine: row.end_line, moduleKey: file.moduleKey,
              detail: row.kind, snippet: row.signature,
            });
          }
          return hits.slice(0, LIMIT);
        })());
      }
    }

    if (kinds.has('file')) {
      // Path matching runs in memory over the already loaded file list: same semantics as the
      // symbol stages (exact path or basename, prefix of the basename, substring of the path).
      sources.push((async () => {
        const needle = query.toLowerCase();
        const hits: SearchHit[] = [];
        for (const file of files) {
          if (!inModule(file.moduleKey)) continue;
          const lower = file.path.toLowerCase();
          const base = lower.slice(lower.lastIndexOf('/') + 1);
          let stage: SearchStage | null = null;
          if (lower === needle || base === needle) stage = 'exact';
          else if (base.startsWith(needle)) stage = 'prefix';
          else if (lower.includes(needle)) stage = 'fuzzy';
          if (!stage) continue;
          hits.push({
            kind: 'file', stage, key: hitKey('file', file.path, '', null),
            score: scoreHit({ stage, kind: 'file', isTest: file.kind === 'test', isDoc: file.kind === 'doc' }),
            title: file.path.slice(file.path.lastIndexOf('/') + 1), path: file.path, startLine: null, endLine: null,
            moduleKey: file.moduleKey, detail: file.kind, snippet: null,
          });
        }
        return hits.sort((a, b) => b.score - a.score).slice(0, LIMIT);
      })());
    }

    if (kinds.has('document')) {
      sources.push((async () => {
        const { data, error } = await db.from('engineering_documents')
          .select('doc_key, title, module_key, file_id, review_status').eq('run_id', runId).ilike('title', stagePattern('fuzzy', query)).limit(LIMIT);
        if (error) throw error;
        const hits: SearchHit[] = [];
        for (const row of (data ?? []) as Array<{ doc_key: string; title: string; module_key: string | null; file_id: string; review_status: string }>) {
          if (!inModule(row.module_key)) continue;
          const file = fileById.get(row.file_id);
          if (!file) continue;
          const stage: SearchStage = row.title.toLowerCase() === query.toLowerCase() ? 'exact' : row.title.toLowerCase().startsWith(query.toLowerCase()) ? 'prefix' : 'fuzzy';
          hits.push({
            kind: 'document', stage, key: hitKey('document', file.path, row.doc_key, null),
            score: scoreHit({ stage, kind: 'document' }), title: row.title, path: file.path, startLine: null, endLine: null,
            moduleKey: row.module_key, detail: row.review_status, snippet: null,
          });
        }
        return hits;
      })());
    }

    if (kinds.has('chunk')) {
      const tsQuery = buildTsQuery(query);
      if (tsQuery) {
        sources.push((async () => {
          const { data, error } = await db.from('engineering_chunks')
            .select('file_id, kind, title, body, start_line, end_line')
            .eq('run_id', runId).textSearch('search', tsQuery, { config: 'simple' }).limit(LIMIT * 3);
          if (error) throw error;
          const hits: SearchHit[] = [];
          for (const row of (data ?? []) as Array<{ file_id: string; kind: string; title: string; body: string; start_line: number; end_line: number }>) {
            const file = fileById.get(row.file_id);
            if (!file || !inModule(file.moduleKey)) continue;
            hits.push({
              kind: 'chunk', stage: 'fulltext', key: hitKey('chunk', file.path, row.title, row.start_line),
              score: scoreHit({ stage: 'fulltext', kind: 'chunk', isTest: file.kind === 'test', isDoc: file.kind === 'doc' }),
              title: row.title, path: file.path, startLine: row.start_line, endLine: row.end_line, moduleKey: file.moduleKey,
              detail: row.kind, snippet: makeSnippet(row.body, query),
            });
          }
          return hits.slice(0, LIMIT);
        })());
      }
    }

    const merged = mergeHits(await Promise.all(sources));
    return { state: 'ok', query, hits: merged.hits, total: merged.total };
  } catch (error) {
    console.error('[engineering/search] failed:', (error as { code?: string })?.code ?? 'unknown');
    return { state: 'unavailable' };
  }
}
