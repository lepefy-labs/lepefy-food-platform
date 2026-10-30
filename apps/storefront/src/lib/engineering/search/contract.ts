/**
 * Engineering Hub search: the single contract shared by the UI, the HTTP API and (unit C)
 * the AI tools. Pure: no imports from Next or Supabase, so it is unit-testable.
 *
 * Stages, in decreasing strength: exact name, prefix, full text (chunks, 'simple' config),
 * fuzzy (substring through the pg_trgm GIN indexes). True trigram similarity ranking needs an
 * RPC and is not part of this unit; the fuzzy stage is honest about being a substring match.
 */
import { LIMITS } from '../domain';

export const SEARCH_STAGES = ['exact', 'prefix', 'fulltext', 'fuzzy'] as const;
export type SearchStage = (typeof SEARCH_STAGES)[number];

export const SEARCH_KINDS = ['symbol', 'file', 'document', 'chunk'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export const SEARCH_LIMITS = { maxQueryLength: 120, minQueryLength: 2, perSourceLimit: 25, maxResults: 30 } as const;

export interface SearchRequest {
  query: string;
  moduleKey?: string | null;
  kinds?: SearchKind[];
}

export interface SearchHit {
  kind: SearchKind;
  stage: SearchStage;
  score: number;
  title: string;
  path: string;
  startLine: number | null;
  endLine: number | null;
  moduleKey: string | null;
  /** Symbol kind / file kind / chunk kind, for a badge. */
  detail: string | null;
  snippet: string | null;
  /** Identity used to drop duplicates across stages. */
  key: string;
}

export type SearchOutcome =
  | { state: 'ok'; query: string; hits: SearchHit[]; total: number }
  | { state: 'invalid'; reason: 'too_short' | 'empty' }
  | { state: 'empty_index' }
  | { state: 'unavailable' };

/** Trims, strips control characters and caps the length. Returns '' when nothing usable is left. */
export function normalizeQuery(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SEARCH_LIMITS.maxQueryLength);
}

export function validateQuery(raw: unknown): { ok: true; query: string } | { ok: false; reason: 'too_short' | 'empty' } {
  const query = normalizeQuery(raw);
  if (!query) return { ok: false, reason: 'empty' };
  if (query.length < SEARCH_LIMITS.minQueryLength) return { ok: false, reason: 'too_short' };
  return { ok: true, query };
}

/** Escapes `\`, `%` and `_` so user text is matched literally by LIKE/ILIKE. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Identifier-like words of the query, lower-cased. Everything else is dropped. */
export function queryTokens(query: string): string[] {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return tokens.filter((token) => token.length >= 2).slice(0, 8);
}

/**
 * to_tsquery text for the 'simple' configuration: every token must appear, each as a prefix.
 * Only [a-z0-9_] characters survive, so the string cannot carry tsquery operators.
 */
export function buildTsQuery(query: string, mode: 'and' | 'or' = 'and'): string | null {
  const tokens = queryTokens(query)
    .map((token) => token.normalize('NFD').replace(/[^a-z0-9_]/g, ''))
    .filter((token) => token.length >= 2);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `${token}:*`).join(mode === 'and' ? ' & ' : ' | ');
}

/** Lower-cased words of a multi-word query (identifiers such as purchaseQuantityRules contain several of them). */
export function wordTokens(query: string): string[] {
  const tokens = queryTokens(query).map((token) => token.normalize('NFD').replace(/[^a-z0-9_]/g, '')).filter((token) => token.length >= 3);
  return /\s/.test(query.trim()) ? [...new Set(tokens)].slice(0, 4) : [];
}

export function containsAllTokens(text: string, tokens: string[]): boolean {
  const lower = text.toLowerCase();
  return tokens.length > 0 && tokens.every((token) => lower.includes(token));
}

/**
 * Hits an AI tool turns into evidence: code and migrations first, documents only after, so a
 * prose page that mentions the topic never crowds out the file that implements it.
 */
export function pickToolHits(hits: SearchHit[], max: number, minCode: number = 4): SearchHit[] {
  const isProse = (hit: SearchHit) => hit.kind === 'document' || hit.detail === 'doc' || hit.path.endsWith('.md');
  const code = hits.filter((hit) => !isProse(hit));
  const prose = hits.filter(isProse);
  const picked = [...code.slice(0, Math.max(minCode, max - prose.length)), ...prose].slice(0, max);
  return hits.filter((hit) => picked.includes(hit));
}

export function makeSnippet(body: string, query: string, maxLength = 220): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const lower = flat.toLowerCase();
  let index = -1;
  for (const token of queryTokens(query)) {
    const found = lower.indexOf(token);
    if (found !== -1 && (index === -1 || found < index)) index = found;
  }
  if (index === -1) return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
  const start = Math.max(0, index - 60);
  const slice = flat.slice(start, start + maxLength);
  return `${start > 0 ? '…' : ''}${slice}${start + maxLength < flat.length ? '…' : ''}`;
}

const STAGE_BASE: Record<SearchStage, number> = { exact: 100, prefix: 70, fulltext: 50, fuzzy: 30 };

export function baseScore(stage: SearchStage): number {
  return STAGE_BASE[stage];
}

export interface ScoreInput {
  stage: SearchStage;
  kind: SearchKind;
  exported?: boolean;
  isTest?: boolean;
  isDoc?: boolean;
}

/** Stage dominates; small boosts break ties inside a stage. Never lets a weaker stage outrank a stronger one. */
export function scoreHit(input: ScoreInput): number {
  let score = baseScore(input.stage);
  if (input.exported) score += 5;
  if (input.kind === 'document') score += 3;
  if (input.isDoc) score += 2;
  if (input.isTest) score -= 8;
  return Math.min(score, baseScore(input.stage) + 9);
}

/** Merges hits from every source: best score per identity, sorted, capped. Deterministic. */
export function mergeHits(sources: SearchHit[][], max: number = SEARCH_LIMITS.maxResults): { hits: SearchHit[]; total: number } {
  const best = new Map<string, SearchHit>();
  for (const hits of sources) {
    for (const hit of hits) {
      const current = best.get(hit.key);
      if (!current || hit.score > current.score) best.set(hit.key, hit);
    }
  }
  const all = [...best.values()].sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.startLine ?? 0) - (b.startLine ?? 0));
  return { hits: all.slice(0, max), total: all.length };
}

export function hitKey(kind: SearchKind, path: string, name: string, startLine: number | null): string {
  return `${kind}:${path.slice(0, LIMITS.maxPathLength)}#${name}@${startLine ?? 0}`;
}
