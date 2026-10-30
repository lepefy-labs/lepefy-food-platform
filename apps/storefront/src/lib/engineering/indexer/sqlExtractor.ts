/**
 * Conservative SQL extraction: only objects named by a literal `create …` / `alter table …`
 * statement. Comments are blanked first (so the commented rollback blocks of the migrations
 * produce nothing), strings and dollar-quoted bodies are skipped when splitting statements.
 * No parsing of column types, no inference from function bodies: what is not named is not reported.
 */
import { createHash } from 'node:crypto';
import { LIMITS, type SymbolKind } from '../domain';

export interface SqlObject {
  name: string;
  kind: SymbolKind;
  signature: string;
  startLine: number;
  endLine: number;
  contentHash: string;
}

export interface SqlAlteration {
  table: string;
  line: number;
}

export interface SqlFacts {
  objects: SqlObject[];
  alterations: SqlAlteration[];
}

/** Replace comments with spaces, keeping newlines so line numbers stay exact. */
export function blankSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') { out += ' '; i += 1; }
    } else if (c === '/' && next === '*') {
      let depth = 1;
      out += '  '; i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth += 1; out += '  '; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth -= 1; out += '  '; i += 2; }
        else { out += sql[i] === '\n' ? '\n' : ' '; i += 1; }
      }
    } else if (c === "'") {
      out += c; i += 1;
      while (i < n) {
        out += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") { out += sql[i + 1]; i += 2; continue; }
        if (sql[i] === "'") { i += 1; break; }
        i += 1;
      }
    } else if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 40));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? n : end + tag[0].length;
        out += sql.slice(i, stop); // dollar-quoted body is kept as is (comments inside are code-level text)
        i = stop;
      } else { out += c; i += 1; }
    } else { out += c; i += 1; }
  }
  return out;
}

interface Statement {
  text: string;
  startOffset: number;
  endOffset: number;
}

function splitStatements(clean: string): Statement[] {
  const statements: Statement[] = [];
  let start = 0;
  let i = 0;
  const n = clean.length;
  while (i < n) {
    const c = clean[i];
    if (c === "'") {
      i += 1;
      while (i < n) {
        if (clean[i] === "'" && clean[i + 1] === "'") { i += 2; continue; }
        if (clean[i] === "'") { i += 1; break; }
        i += 1;
      }
    } else if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(clean.slice(i, i + 40));
      if (tag) {
        const end = clean.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? n : end + tag[0].length;
      } else i += 1;
    } else if (c === ';') {
      statements.push({ text: clean.slice(start, i), startOffset: start, endOffset: i });
      i += 1;
      start = i;
    } else i += 1;
  }
  if (clean.slice(start).trim()) statements.push({ text: clean.slice(start), startOffset: start, endOffset: n });
  return statements;
}

const IDENT = '(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)';
const QUALIFIED = `((?:${IDENT}\\.)?${IDENT})`;

function unqualify(name: string): string {
  const last = name.split('.').pop() ?? name;
  return last.replace(/^"|"$/g, '');
}

const HEADS: Array<{ kind: SymbolKind; pattern: RegExp }> = [
  { kind: 'table', pattern: new RegExp(`^create\\s+(?:unlogged\\s+|temporary\\s+|temp\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?${QUALIFIED}`, 'i') },
  { kind: 'view', pattern: new RegExp(`^create\\s+(?:or\\s+replace\\s+)?(?:materialized\\s+)?view\\s+${QUALIFIED}`, 'i') },
  { kind: 'sql_function', pattern: new RegExp(`^create\\s+(?:or\\s+replace\\s+)?function\\s+${QUALIFIED}`, 'i') },
  { kind: 'trigger', pattern: new RegExp(`^create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+${QUALIFIED}`, 'i') },
  { kind: 'index', pattern: new RegExp(`^create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?(?:if\\s+not\\s+exists\\s+)?${QUALIFIED}`, 'i') },
  { kind: 'policy', pattern: new RegExp(`^create\\s+policy\\s+(${IDENT})`, 'i') },
];
const ALTER_TABLE = new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${QUALIFIED}`, 'i');

export function extractSql(content: string): SqlFacts {
  const clean = blankSqlComments(content);
  const lineStarts: number[] = [0];
  for (let i = 0; i < clean.length; i += 1) if (clean[i] === '\n') lineStarts.push(i + 1);
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };

  const objects: SqlObject[] = [];
  const alterations: SqlAlteration[] = [];
  for (const statement of splitStatements(clean)) {
    const leading = statement.text.length - statement.text.trimStart().length;
    const text = statement.text.trimStart();
    if (!text) continue;
    const startLine = lineAt(statement.startOffset + leading);
    const endLine = lineAt(Math.max(statement.startOffset + leading, statement.endOffset - 1));
    const alter = ALTER_TABLE.exec(text);
    if (alter) {
      alterations.push({ table: unqualify(alter[1] ?? ''), line: startLine });
      continue;
    }
    for (const head of HEADS) {
      const match = head.pattern.exec(text);
      if (!match) continue;
      const name = unqualify(match[1] ?? '');
      let signature = text.slice(0, 400).replace(/\s+/g, ' ').trim();
      if (head.kind === 'sql_function') {
        const open = text.indexOf('(', match[0].length - 1);
        const stop = text.search(/\b(language|as)\b/i);
        signature = text.slice(match[0].length - (match[1] ?? '').length, stop > open ? stop : undefined).replace(/\s+/g, ' ').trim();
      }
      objects.push({
        name: name.slice(0, LIMITS.maxSymbolName),
        kind: head.kind,
        signature: signature.slice(0, LIMITS.maxSignature),
        startLine,
        endLine,
        contentHash: createHash('sha1').update(text).digest('hex'),
      });
      break;
    }
  }
  return { objects, alterations };
}
