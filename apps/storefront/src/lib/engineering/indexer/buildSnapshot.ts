/**
 * Builds an index snapshot from a list of repository files. Pure and deterministic:
 * the same files always produce the same snapshot (sorted, deduplicated), which is what
 * makes a re-run idempotent. Reading the files (git) and uploading is somebody else's job.
 */
import { createHash } from 'node:crypto';
import {
  LIMITS, symbolKey,
  type ExcludedFile, type IndexSnapshot, type IndexedChunk, type IndexedDocument, type IndexedFile, type IndexedRelation,
  type IndexedSymbol, type SnapshotManifest,
} from '../domain';
import { exclusionForContent, exclusionForPath } from '../exclusions';
import { ENGINEERING_MODULES, moduleForPath } from '../moduleRegistry';
import { kindOf, languageOf, routeOf } from './classify';
import { extractMarkdown, parseDocStatus } from './markdownExtractor';
import { extractSql } from './sqlExtractor';
import { extractTypeScript } from './typescriptExtractor';

export interface SourceFile {
  path: string;
  /** Decoded text, or null when the bytes are not text. */
  content: string | null;
}

export interface BuildInput {
  repository: string;
  branch: string;
  commitSha: string;
  mode: 'full' | 'incremental';
  files: SourceFile[];
}

const ALIAS_ROOT = 'apps/storefront/src/';
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js'];

/** Git blob object id of a text file. */
export function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

export function compareBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Same formula as the SQL side (engineering_finalize_run). */
export function filesChecksum(files: Array<{ path: string; blobSha: string }>): string {
  const lines = [...files].sort((a, b) => compareBytes(a.path, b.path)).map((file) => `${file.path} ${file.blobSha}`);
  return createHash('md5').update(lines.join('\n')).digest('hex');
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function resolveImport(from: string, specifier: string, known: Set<string>): { resolved: string | null; external: string | null } {
  let base: string | null = null;
  if (specifier.startsWith('.')) base = normalize(`${dirname(from)}/${specifier}`);
  else if (specifier.startsWith('@/')) base = `${ALIAS_ROOT}${specifier.slice(2)}`;
  else if (specifier === '@lepefy/types') base = 'packages/types/index';
  else if (specifier.startsWith('@lepefy/types/')) base = `packages/types/${specifier.slice('@lepefy/types/'.length)}`;
  if (base !== null) {
    for (const suffix of RESOLVE_SUFFIXES) {
      if (known.has(base + suffix)) return { resolved: base + suffix, external: null };
    }
    // Run-time `.js` specifiers that point to a `.ts` source.
    const stripped = base.replace(/\.[cm]?js$/, '');
    for (const suffix of ['.ts', '.tsx']) {
      if (stripped !== base && known.has(stripped + suffix)) return { resolved: stripped + suffix, external: null };
    }
    return { resolved: null, external: null };
  }
  if (specifier.startsWith('node:')) return { resolved: null, external: specifier };
  const parts = specifier.split('/');
  return { resolved: null, external: specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? specifier };
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < content.length; i += 1) if (content.charCodeAt(i) === 10) count += 1;
  return content.endsWith('\n') ? count - 1 : count;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function splitWords(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
}

export function buildSnapshot(input: BuildInput): IndexSnapshot {
  const excluded: ExcludedFile[] = [];
  const kept: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();

  for (const file of [...input.files].sort((a, b) => compareBytes(a.path, b.path))) {
    if (seen.has(file.path)) continue;
    seen.add(file.path);
    const byPath = exclusionForPath(file.path);
    if (byPath) { excluded.push({ path: file.path, reasonCode: byPath }); continue; }
    if (file.content === null) { excluded.push({ path: file.path, reasonCode: 'binary_content' }); continue; }
    const byContent = exclusionForContent(file.content, { isTestFile: kindOf(file.path) === 'test' });
    if (byContent) { excluded.push({ path: file.path, reasonCode: byContent }); continue; }
    kept.push({ path: file.path, content: file.content });
  }

  const known = new Set(kept.map((file) => file.path));
  const files: IndexedFile[] = [];
  const symbols: IndexedSymbol[] = [];
  const relations: IndexedRelation[] = [];
  const documents: IndexedDocument[] = [];
  const chunks: IndexedChunk[] = [];
  const blobs: Record<string, string> = {};
  const diagnostics: Array<{ path: string; code: string }> = [];
  const relationKeys = new Set<string>();

  const addRelation = (relation: IndexedRelation) => {
    const key = `${relation.fromPath}|${relation.kind}|${relation.toPath ?? ''}|${relation.targetRef ?? ''}`;
    if (relationKeys.has(key)) return;
    relationKeys.add(key);
    relations.push(relation);
  };
  const addChunk = (chunk: IndexedChunk) => {
    chunks.push({ ...chunk, title: clip(chunk.title, 300), body: clip(chunk.body, LIMITS.maxChunkBody) });
  };

  // Migration numbers → migration paths, for the SQL test convention (supabase/tests/NNN_*.sql).
  const migrationByNumber = new Map<string, string[]>();
  for (const path of known) {
    const match = /^supabase\/migrations\/(\d+)_/.exec(path);
    if (match?.[1]) migrationByNumber.set(match[1], [...(migrationByNumber.get(match[1]) ?? []), path]);
  }

  for (const file of kept) {
    const { path, content } = file;
    const kind = kindOf(path);
    const language = languageOf(path);
    const blobSha = gitBlobSha(content);
    blobs[blobSha] = content;
    files.push({
      path, kind, language, blobSha, sizeBytes: Buffer.byteLength(content, 'utf8'), lineCount: countLines(content),
      moduleKey: moduleForPath(path),
    });

    const route = routeOf(path);
    if (route) {
      addRelation({ fromPath: path, toPath: null, kind: 'handles_route', targetRef: route.route, evidenceLine: 1 });
    }

    try {
      if (language === 'typescript' || language === 'javascript') {
        const facts = extractTypeScript(path, content);
        for (const raw of facts.symbols) {
          const { doc, ...symbol } = raw;
          symbols.push({ path, ...symbol });
          const documented = symbol.exported || symbol.kind === 'route_handler' || symbol.kind === 'test';
          if (documented) {
            addChunk({
              path, kind: 'symbol', symbolKey: symbolKey(path, symbol.name, symbol.startLine), docKey: null,
              title: `${symbol.name} ${splitWords(symbol.name)}`,
              body: [symbol.kind, symbol.signature ?? '', doc ?? ''].filter(Boolean).join('\n'),
              startLine: symbol.startLine, endLine: symbol.endLine,
            });
          }
        }
        if (facts.headerComment || route) {
          addChunk({
            path, kind: 'file_header', symbolKey: null, docKey: null, title: path,
            body: [route ? `${route.kind === 'api' ? 'API' : 'Pagina'} ${route.route}` : '', facts.headerComment ?? ''].filter(Boolean).join('\n'),
            startLine: 1, endLine: 1,
          });
        }
        for (const imp of facts.imports) {
          const target = resolveImport(path, imp.specifier, known);
          if (target.resolved) {
            const targetKind = kindOf(target.resolved);
            addRelation({
              fromPath: path, toPath: target.resolved,
              kind: kind === 'test' && targetKind !== 'test' ? 'tests' : 'imports',
              targetRef: null, evidenceLine: imp.line,
            });
          } else if (target.external) {
            addRelation({ fromPath: path, toPath: null, kind: 'imports', targetRef: target.external, evidenceLine: imp.line });
          }
        }
        for (const ref of facts.references) {
          addRelation({ fromPath: path, toPath: null, kind: ref.kind, targetRef: ref.target, evidenceLine: ref.line });
        }
      } else if (language === 'sql') {
        const facts = extractSql(content);
        for (const object of facts.objects) {
          symbols.push({
            path, name: object.name, kind: object.kind, exported: true, signature: object.signature,
            startLine: object.startLine, endLine: object.endLine, contentHash: object.contentHash, parentName: null,
          });
          addChunk({
            path, kind: 'sql_object', symbolKey: symbolKey(path, object.name, object.startLine), docKey: null,
            title: `${object.name} ${splitWords(object.name)}`, body: `${object.kind}\n${object.signature}`,
            startLine: object.startLine, endLine: object.endLine,
          });
          addRelation({ fromPath: path, toPath: null, kind: 'defines_object', targetRef: object.name, evidenceLine: object.startLine });
        }
        for (const alteration of facts.alterations) {
          addRelation({ fromPath: path, toPath: null, kind: 'defines_object', targetRef: alteration.table, evidenceLine: alteration.line });
        }
        const testNumber = /^supabase\/tests\/(\d+)_/.exec(path);
        if (testNumber) {
          for (const migration of migrationByNumber.get(testNumber[1] ?? '') ?? []) {
            addRelation({ fromPath: path, toPath: migration, kind: 'tests', targetRef: null, evidenceLine: 1 });
          }
        }
      } else if (language === 'markdown') {
        const facts = extractMarkdown(path, content);
        const front = facts.frontMatter;
        const docKey = front?.id?.trim() || path;
        const verifiedSha = front?.sha_verificato && /^[0-9a-f]{7,40}$/.test(front.sha_verificato) ? front.sha_verificato : null;
        let reviewStatus = parseDocStatus(front?.stato);
        // "Verified" without the commit it was verified at is not a verification.
        if (reviewStatus === 'verified' && !verifiedSha) reviewStatus = 'to_review';
        const monitored = (front?.file_monitorati ?? []).filter((item) => item.length <= LIMITS.maxPathLength);
        documents.push({
          path, docKey, title: clip(facts.title, 300),
          moduleKey: front?.modulo?.trim() || moduleForPath(path),
          category: front?.categoria?.trim() || null,
          reviewStatus, verifiedSha,
          owner: front?.owner?.trim() || null,
          verifiedOn: front?.data_verifica && /^\d{4}-\d{2}-\d{2}$/.test(front.data_verifica) ? front.data_verifica : null,
          monitoredFiles: monitored,
        });
        for (const section of facts.sections) {
          addChunk({
            path, kind: 'doc_section', symbolKey: null, docKey, title: section.title || facts.title, body: section.body,
            startLine: section.startLine, endLine: section.endLine,
          });
        }
        for (const ref of facts.pathReferences) {
          const target = normalize(ref.path);
          if (known.has(target) && target !== path) {
            addRelation({ fromPath: path, toPath: target, kind: 'documents', targetRef: null, evidenceLine: ref.line });
          }
        }
        for (const monitoredPath of monitored) {
          const target = normalize(monitoredPath);
          if (known.has(target) && target !== path) {
            addRelation({ fromPath: path, toPath: target, kind: 'documents', targetRef: null, evidenceLine: 1 });
          }
        }
      }
    } catch {
      diagnostics.push({ path, code: 'extract_failed' });
    }
  }

  symbols.sort((a, b) => compareBytes(a.path, b.path) || a.startLine - b.startLine || compareBytes(a.name, b.name));
  relations.sort((a, b) =>
    compareBytes(a.fromPath, b.fromPath) || a.kind.localeCompare(b.kind) || compareBytes(a.toPath ?? a.targetRef ?? '', b.toPath ?? b.targetRef ?? ''));
  chunks.sort((a, b) => compareBytes(a.path, b.path) || a.startLine - b.startLine || a.kind.localeCompare(b.kind));
  documents.sort((a, b) => compareBytes(a.docKey, b.docKey));

  // Document keys must be unique inside a run: keep the first, record the others.
  const docKeys = new Set<string>();
  const uniqueDocuments = documents.filter((document) => {
    if (docKeys.has(document.docKey)) { diagnostics.push({ path: document.path, code: 'duplicate_doc_key' }); return false; }
    docKeys.add(document.docKey);
    return true;
  });
  const validChunks = chunks.filter((chunk) => chunk.docKey === null || docKeys.has(chunk.docKey));

  const manifest: SnapshotManifest = {
    files: files.length,
    symbols: symbols.length,
    relations: relations.length,
    documents: uniqueDocuments.length,
    chunks: validChunks.length,
    excluded: excluded.length,
    checksum: filesChecksum(files),
  };

  return {
    repository: input.repository,
    branch: input.branch,
    commitSha: input.commitSha,
    mode: input.mode,
    files,
    symbols,
    relations,
    documents: uniqueDocuments,
    chunks: validChunks,
    modules: ENGINEERING_MODULES,
    excluded,
    blobs,
    diagnostics,
    manifest,
  };
}
