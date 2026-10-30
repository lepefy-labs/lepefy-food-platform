/**
 * Pure derivations behind the Hub explorers (overview, modules, architecture, code tree).
 * Inputs are plain rows read from the active run; nothing here is invented: every figure is a
 * count or a grouping of indexed facts.
 */
import { DOC_REVIEW_LABELS_IT, type DocReviewStatus, type FileKind } from './domain';

export interface FileRow {
  id: string;
  path: string;
  kind: FileKind;
  moduleKey: string | null;
  sizeBytes: number;
  lineCount: number;
}

export interface DocumentRow {
  docKey: string;
  title: string;
  path: string;
  moduleKey: string | null;
  reviewStatus: DocReviewStatus;
  verifiedSha: string | null;
}

export interface ImportEdge {
  fromFileId: string;
  toFileId: string;
}

export interface ModuleStats {
  moduleKey: string;
  files: number;
  byKind: Partial<Record<FileKind, number>>;
  lines: number;
  apiRoutes: number;
  pages: number;
  tests: number;
  migrations: number;
  documents: DocumentRow[];
}

export function summarizeModule(moduleKey: string, files: FileRow[], documents: DocumentRow[]): ModuleStats {
  const own = files.filter((file) => file.moduleKey === moduleKey);
  const byKind: Partial<Record<FileKind, number>> = {};
  let lines = 0;
  for (const file of own) {
    byKind[file.kind] = (byKind[file.kind] ?? 0) + 1;
    lines += file.lineCount;
  }
  return {
    moduleKey,
    files: own.length,
    byKind,
    lines,
    apiRoutes: byKind.api_route ?? 0,
    pages: byKind.page ?? 0,
    tests: byKind.test ?? 0,
    migrations: byKind.migration ?? 0,
    documents: documents.filter((doc) => doc.moduleKey === moduleKey),
  };
}

/** Coverage label of a module from its documents. A module is "Verificata" only if a document says so. */
export function moduleDocStatus(documents: DocumentRow[]): { status: DocReviewStatus | 'none'; label: string } {
  if (documents.length === 0) return { status: 'none', label: 'Nessun documento' };
  // Weakest status wins: one document to review means the module is to review.
  const order: DocReviewStatus[] = ['to_review', 'inventoried', 'partial', 'indexed', 'verified'];
  const status = order.find((candidate) => documents.some((doc) => doc.reviewStatus === candidate)) ?? 'indexed';
  return { status, label: DOC_REVIEW_LABELS_IT[status] };
}

export interface ModuleDependency {
  from: string;
  to: string;
  imports: number;
}

/** Module-to-module import counts, from demonstrated `imports` edges between indexed files. */
export function moduleDependencies(edges: ImportEdge[], fileById: Map<string, FileRow>): ModuleDependency[] {
  const counts = new Map<string, number>();
  for (const edge of edges) {
    const from = fileById.get(edge.fromFileId)?.moduleKey;
    const to = fileById.get(edge.toFileId)?.moduleKey;
    if (!from || !to || from === to) continue;
    const key = `${from}\u0000${to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, imports]) => {
      const [from = '', to = ''] = key.split('\u0000');
      return { from, to, imports };
    })
    .sort((a, b) => b.imports - a.imports || (a.from + a.to < b.from + b.to ? -1 : 1));
}

export interface DirectoryListing {
  dir: string;
  directories: Array<{ name: string; path: string; files: number }>;
  files: FileRow[];
}

/** Lists the direct children of a directory ('' = repository root) from the flat file list. */
export function listDirectory(files: FileRow[], dir: string): DirectoryListing {
  const prefix = dir ? `${dir}/` : '';
  const subdirs = new Map<string, number>();
  const direct: FileRow[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash === -1) direct.push(file);
    else {
      const name = rest.slice(0, slash);
      subdirs.set(name, (subdirs.get(name) ?? 0) + 1);
    }
  }
  return {
    dir,
    directories: [...subdirs.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, count]) => ({ name, path: `${prefix}${name}`, files: count })),
    files: direct.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}

/** Files and lines per top-level area: first two segments, or three under `apps/storefront/src`. */
export function topLevelAreas(files: FileRow[]): Array<{ path: string; files: number; lines: number }> {
  const areas = new Map<string, { files: number; lines: number }>();
  for (const file of files) {
    const parts = file.path.split('/');
    const depth = file.path.startsWith('apps/storefront/src/') ? 4 : 2;
    const key = parts.length <= depth ? parts.slice(0, parts.length - 1).join('/') || parts[0] || '' : parts.slice(0, depth).join('/');
    const current = areas.get(key) ?? { files: 0, lines: 0 };
    current.files += 1;
    current.lines += file.lineCount;
    areas.set(key, current);
  }
  return [...areas.entries()].map(([path, value]) => ({ path, ...value })).sort((a, b) => b.files - a.files || (a.path < b.path ? -1 : 1));
}

/** Accepts only a normalized repository-relative path: no traversal, no leading slash, bounded. */
export function sanitizeRepoPath(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const value = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!value || value.length > 500) return '';
  if (value.split('/').some((part) => part === '' || part === '.' || part === '..')) return '';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return '';
  return value;
}

export function parentDirectory(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** True when a commit sha is the same revision (short or full). */
export function sameCommit(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 7 && long.startsWith(short);
}

/**
 * A verified document is "stale" when files it monitors changed after its verified sha.
 * Without a blob comparison per file we can only say it is unverifiable against the current
 * commit: the CI check (unit D) does the real comparison. Here: verified without a sha at the
 * indexed commit is reported as "to re-check".
 */
export function docNeedsRecheck(doc: Pick<DocumentRow, 'reviewStatus' | 'verifiedSha'>, indexedSha: string): boolean {
  return doc.reviewStatus === 'verified' && !sameCommit(doc.verifiedSha, indexedSha);
}
