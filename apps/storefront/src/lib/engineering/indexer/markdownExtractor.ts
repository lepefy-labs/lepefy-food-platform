/**
 * Markdown extraction: optional front matter (technical-document metadata), heading
 * sections for search chunks, and path-like references for `documents` relations.
 * Headings inside code fences are not headings.
 */
import { DOC_REVIEW_STATUSES, LIMITS, type DocReviewStatus } from '../domain';

export interface FrontMatter {
  id?: string;
  titolo?: string;
  modulo?: string;
  categoria?: string;
  stato?: string;
  owner?: string;
  sha_verificato?: string;
  data_verifica?: string;
  file_monitorati?: string[];
}

export interface MarkdownSection {
  title: string;
  body: string;
  startLine: number;
  endLine: number;
}

export interface MarkdownFacts {
  frontMatter: FrontMatter | null;
  title: string;
  sections: MarkdownSection[];
  /** Backtick spans that look like repository paths, with their line. */
  pathReferences: Array<{ path: string; line: number }>;
  /** Backtick spans that look like identifiers (functions, tables), with their line. */
  identifierReferences: Array<{ name: string; line: number }>;
}

const STATUS_ALIASES: Record<string, DocReviewStatus> = {
  inventariato: 'inventoried',
  inventoried: 'inventoried',
  indicizzato: 'indexed',
  indexed: 'indexed',
  parziale: 'partial',
  partial: 'partial',
  verificata: 'verified',
  verificato: 'verified',
  verified: 'verified',
  da_revisionare: 'to_review',
  'da revisionare': 'to_review',
  to_review: 'to_review',
};

export function parseDocStatus(value: string | undefined | null): DocReviewStatus {
  const normalized = (value ?? '').trim().toLowerCase();
  const mapped = STATUS_ALIASES[normalized];
  return mapped && (DOC_REVIEW_STATUSES as readonly string[]).includes(mapped) ? mapped : 'indexed';
}

function parseList(value: string): string[] {
  const trimmed = value.trim();
  const inner = trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed;
  return inner.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

/** Minimal front matter reader (flat keys, inline or dash lists). Anything else is ignored. */
export function parseFrontMatter(content: string): { data: FrontMatter | null; bodyStartLine: number } {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return { data: null, bodyStartLine: 1 };
  const lines = content.split(/\r?\n/);
  const end = lines.indexOf('---', 1);
  if (end === -1) return { data: null, bodyStartLine: 1 };
  const data: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (let i = 1; i < end; i += 1) {
    const line = lines[i] ?? '';
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push((item[1] ?? '').trim().replace(/^['"]|['"]$/g, ''));
      continue;
    }
    const pair = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!pair) { listKey = null; continue; }
    const key = pair[1] ?? '';
    const value = pair[2] ?? '';
    if (value === '') { data[key] = []; listKey = key; }
    else if (key === 'file_monitorati') { data[key] = parseList(value); listKey = null; }
    else { data[key] = value.trim().replace(/^['"]|['"]$/g, ''); listKey = null; }
  }
  return { data: data as FrontMatter, bodyStartLine: end + 2 };
}

const FENCE = /^\s*(```|~~~)/;
const PATH_LIKE = /^(?:[A-Za-z0-9_.@()[\]-]+\/)+[A-Za-z0-9_.@()[\]-]+(?:\.[A-Za-z0-9]+)?(?::\d+(?:-\d+)?)?$/;
const IDENTIFIER_LIKE = /^[A-Za-z_][A-Za-z0-9_]{3,}(?:\(\))?$/;

export function extractMarkdown(path: string, content: string): MarkdownFacts {
  const lines = content.split(/\r?\n/);
  const { data, bodyStartLine } = parseFrontMatter(content);
  const sections: MarkdownSection[] = [];
  const pathReferences: Array<{ path: string; line: number }> = [];
  const identifierReferences: Array<{ name: string; line: number }> = [];

  let inFence = false;
  let current: { title: string; startLine: number; body: string[] } | null = null;
  let title = '';
  const stack: string[] = [];

  const flush = (endLine: number) => {
    if (!current) return;
    const body = current.body.join('\n').trim();
    if (body || current.title) {
      // Split a long section at line boundaries so every chunk stays within the column limit.
      let chunk: string[] = [];
      let chunkStart = current.startLine;
      let size = 0;
      const emit = (end: number) => {
        const text = chunk.join('\n').trim();
        if (text || chunkStart === current!.startLine) {
          sections.push({ title: current!.title, body: text.slice(0, LIMITS.maxChunkBody), startLine: chunkStart, endLine: Math.max(end, chunkStart) });
        }
      };
      current.body.forEach((line, index) => {
        const lineNo = current!.startLine + 1 + index;
        if (size + line.length > LIMITS.chunkTarget && chunk.length > 0) {
          emit(lineNo - 1);
          chunk = [];
          chunkStart = lineNo;
          size = 0;
        }
        chunk.push(line.slice(0, 1000));
        size += line.length + 1;
      });
      emit(endLine);
    }
    current = null;
  };

  for (let index = bodyStartLine - 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNo = index + 1;
    if (FENCE.test(line)) inFence = !inFence;
    const heading = !inFence ? /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (heading) {
      flush(lineNo - 1);
      const level = (heading[1] ?? '').length;
      stack.length = level - 1;
      stack[level - 1] = (heading[2] ?? '').replace(/[`*_]/g, '');
      if (!title && level === 1) title = stack[0] ?? '';
      current = { title: stack.filter(Boolean).join(' › ').slice(0, 300), startLine: lineNo, body: [] };
      continue;
    }
    if (!current) current = { title: title || path, startLine: lineNo, body: [] };
    current!.body.push(line);
    if (!inFence) {
      for (const span of line.matchAll(/`([^`\n]{3,200})`/g)) {
        const text = (span[1] ?? '').trim();
        if (PATH_LIKE.test(text)) pathReferences.push({ path: text.replace(/:\d+(?:-\d+)?$/, ''), line: lineNo });
        else if (IDENTIFIER_LIKE.test(text)) identifierReferences.push({ name: text.replace(/\(\)$/, ''), line: lineNo });
      }
    }
  }
  flush(lines.length);

  return {
    frontMatter: data,
    title: data?.titolo?.trim() || title || path.slice(path.lastIndexOf('/') + 1),
    sections,
    pathReferences,
    identifierReferences,
  };
}
