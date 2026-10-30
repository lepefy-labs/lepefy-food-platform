/**
 * Engineering Hub: shared vocabulary of the technical index
 * (docs/engineering/ARCHITECTURE.md). Pure types and constants, no imports:
 * also run by Node type stripping through scripts/ts-resolve-hooks.mjs.
 */

export const FILE_KINDS = ['source', 'test', 'api_route', 'page', 'component', 'migration', 'sql', 'doc', 'config', 'ci', 'script', 'other'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_LANGUAGES = ['typescript', 'javascript', 'sql', 'markdown', 'yaml', 'json', 'other'] as const;
export type FileLanguage = (typeof FILE_LANGUAGES)[number];

export const SYMBOL_KINDS = [
  'function', 'class', 'interface', 'type', 'enum', 'const', 'component', 'hook', 'route_handler', 'test',
  'table', 'view', 'sql_function', 'trigger', 'policy', 'index',
] as const;
export type SymbolKind = (typeof SYMBOL_KINDS)[number];

/** Only demonstrated relations: each one carries the file and line that prove it. */
export const RELATION_KINDS = ['imports', 'tests', 'calls_rpc', 'uses_table', 'calls_api', 'handles_route', 'defines_object', 'documents'] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const CHUNK_KINDS = ['doc_section', 'symbol', 'sql_object', 'file_header'] as const;
export type ChunkKind = (typeof CHUNK_KINDS)[number];

/** Review state of a technical document: Inventariato / Indicizzato / Parziale / Verificata / Da revisionare. */
export const DOC_REVIEW_STATUSES = ['inventoried', 'indexed', 'partial', 'verified', 'to_review'] as const;
export type DocReviewStatus = (typeof DOC_REVIEW_STATUSES)[number];

export const DOC_REVIEW_LABELS_IT: Record<DocReviewStatus, string> = {
  inventoried: 'Inventariato',
  indexed: 'Indicizzato',
  partial: 'Parziale',
  verified: 'Verificata',
  to_review: 'Da revisionare',
};

/** Limits mirrored by the migration checks (175). */
export const LIMITS = {
  maxPathLength: 500,
  maxFileBytes: 512 * 1024,
  maxSymbolName: 200,
  maxSignature: 600,
  maxChunkBody: 4000,
  chunkTarget: 3500,
  maxRunKey: 120,
} as const;

export interface IndexedFile {
  path: string;
  kind: FileKind;
  language: FileLanguage;
  /** Git blob object id (sha1 of "blob <bytes>\0<content>"). */
  blobSha: string;
  sizeBytes: number;
  lineCount: number;
  moduleKey: string | null;
}

export interface IndexedSymbol {
  path: string;
  name: string;
  kind: SymbolKind;
  exported: boolean;
  signature: string | null;
  startLine: number;
  endLine: number;
  contentHash: string;
  parentName: string | null;
}

export interface IndexedRelation {
  fromPath: string;
  /** Resolved repository file, when the target is a file of the repository. */
  toPath: string | null;
  kind: RelationKind;
  /** Package, table, RPC, route or object name when the target is not a file. */
  targetRef: string | null;
  evidenceLine: number | null;
}

export interface IndexedDocument {
  path: string;
  docKey: string;
  title: string;
  moduleKey: string | null;
  category: string | null;
  reviewStatus: DocReviewStatus;
  verifiedSha: string | null;
  owner: string | null;
  verifiedOn: string | null;
  monitoredFiles: string[];
}

export interface IndexedChunk {
  path: string;
  kind: ChunkKind;
  /** Joins the chunk to its symbol (name@startLine) or document (docKey). */
  symbolKey: string | null;
  docKey: string | null;
  title: string;
  body: string;
  startLine: number;
  endLine: number;
}

export interface ExcludedFile {
  path: string;
  /** Rule that excluded the file. Never the matched value. */
  reasonCode: ExclusionReason;
}

export const EXCLUSION_REASONS = [
  'vendor_path', 'denied_path', 'binary_extension', 'lockfile', 'data_dump', 'generated', 'unsupported_extension',
  'too_large', 'binary_content', 'secret_detected', 'personal_data', 'path_too_long',
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export interface IndexedModule {
  moduleKey: string;
  title: string;
  category: string;
  summary: string;
  pathGlobs: string[];
  position: number;
}

export interface SnapshotManifest {
  files: number;
  symbols: number;
  relations: number;
  documents: number;
  chunks: number;
  excluded: number;
  /** md5 of "<path> <blobSha>" lines in byte order, same formula as engineering_finalize_run. */
  checksum: string;
}

export interface IndexSnapshot {
  repository: string;
  branch: string;
  commitSha: string;
  mode: 'full' | 'incremental';
  files: IndexedFile[];
  symbols: IndexedSymbol[];
  relations: IndexedRelation[];
  documents: IndexedDocument[];
  chunks: IndexedChunk[];
  modules: IndexedModule[];
  excluded: ExcludedFile[];
  /** Blob contents keyed by blob sha; every file has one. Never contains an excluded file. */
  blobs: Record<string, string>;
  /** Non-fatal problems met while extracting (a file whose parse failed keeps its row without symbols). Not stored. */
  diagnostics: Array<{ path: string; code: string }>;
  manifest: SnapshotManifest;
}

export function symbolKey(path: string, name: string, startLine: number): string {
  return `${path}#${name}@${startLine}`;
}

/** GitHub permalink to a line range at the indexed commit. */
export function githubLink(owner: string, repo: string, sha: string, path: string, startLine?: number, endLine?: number): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const anchor = startLine ? `#L${startLine}${endLine && endLine !== startLine ? `-L${endLine}` : ''}` : '';
  return `https://github.com/${owner}/${repo}/blob/${sha}/${encoded}${anchor}`;
}
