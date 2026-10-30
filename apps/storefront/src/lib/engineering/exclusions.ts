/**
 * What never enters the technical index (docs/engineering/SECURITY.md).
 *
 * Two layers: a path layer (allow-list of extensions, deny-list of places) and a
 * content layer (secrets, personal data, binaries, size). A file that trips any
 * rule is excluded WHOLE (never redacted) and only `path + rule id` is kept:
 * the matched value is never returned, logged or stored.
 */
import type { ExclusionReason } from './domain';
import { LIMITS } from './domain';

const VENDOR_DIRS = new Set(['node_modules', '.next', '.git', '.turbo', '.vercel', 'dist', 'build', 'coverage', '.cache', 'out']);
const DENIED_DIRS = ['.claude/', 'artifacts/', 'confirmation-report/', 'test-results/', 'playwright-report/', 'supabase/.temp/', 'supabase/.branches/'];
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'svg', 'bmp', 'tiff', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'pdf', 'zip', 'gz', 'tgz', 'rar', '7z', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'wasm',
]);
const DATA_EXT = new Set(['csv', 'tsv', 'dump', 'sqlite', 'db', 'bak', 'ndjson', 'jsonl', 'sav']);
const LOCKFILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb']);
const CODE_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'sql', 'md', 'mdx', 'yml', 'yaml']);
const JSON_ALLOWED = /(^|\/)(package\.json|tsconfig[^/]*\.json|vercel\.json|components\.json|\.eslintrc\.json)$|^ops\/n8n\/[^/]+\.json$/;

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
function extension(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Rule that excludes the path alone, or null when the path may be read. */
export function exclusionForPath(path: string): ExclusionReason | null {
  if (path.length > LIMITS.maxPathLength) return 'path_too_long';
  const segments = path.split('/');
  if (segments.some((segment) => VENDOR_DIRS.has(segment))) return 'vendor_path';
  if (DENIED_DIRS.some((dir) => path.startsWith(dir) || path.includes(`/${dir}`))) return 'denied_path';
  const name = baseName(path);
  const lower = name.toLowerCase();
  // Environment files: only the explicit example template may be read (and is still scanned).
  if (lower === '.env' || (lower.startsWith('.env.') && lower !== '.env.example')) return 'denied_path';
  if (/\.(pem|key|p12|pfx|crt|cer|jks|keystore)$/i.test(name) || /^id_(rsa|dsa|ecdsa|ed25519)/i.test(name)) return 'denied_path';
  if (lower.endsWith('.local') || lower === '.npmrc' || lower === '.netrc' || lower.includes('credentials')) return 'denied_path';
  if (LOCKFILES.has(lower)) return 'lockfile';
  const ext = extension(path);
  if (BINARY_EXT.has(ext)) return 'binary_extension';
  if (DATA_EXT.has(ext)) return 'data_dump';
  if (lower.endsWith('.d.ts') || lower.endsWith('.tsbuildinfo') || lower.endsWith('.min.js') || lower.endsWith('.map') || lower === 'next-env.d.ts') return 'generated';
  if (ext === 'json') return JSON_ALLOWED.test(path) ? null : 'unsupported_extension';
  if (lower === '.env.example') return null;
  if (!CODE_EXT.has(ext)) return 'unsupported_extension';
  return null;
}

interface SecretRule {
  id: string;
  pattern: RegExp;
}

// No pattern here ever leaves this module with its match.
const SECRET_RULES: SecretRule[] = [
  { id: 'private_key_block', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { id: 'stripe_live_key', pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}/ },
  { id: 'stripe_webhook_secret', pattern: /\bwhsec_[0-9A-Za-z]{20,}/ },
  { id: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: 'github_token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { id: 'slack_token', pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}/ },
  { id: 'google_api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'resend_key', pattern: /\bre_[A-Za-z0-9]{20,}\b/ },
  { id: 'brevo_key', pattern: /\bxkeysib-[a-f0-9]{40,}/ },
];

const CONNECTION_STRING = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:([^\s:@/]{6,})@/g;
const PLACEHOLDER_PASSWORD = /^(?:[[<{$%]|\*+$|(?:your[-_]?)?password$|postgres$|changeme$|secret$|example$|xxx+$)/i;

const ASSIGNMENT = /(?:secret|token|password|passwd|api[_-]?key|private[_-]?key)[A-Za-z0-9_]*\s*[:=]\s*['"`]([A-Za-z0-9+/=_-]{24,})['"`]/gi;

function looksLikeCredentialValue(value: string): boolean {
  return /[A-Za-z]/.test(value) && /\d/.test(value) && !/^(?:x+|0+|test|example|placeholder)/i.test(value);
}

/**
 * Id of the secret rule matched, never the value. The generic "name = 'long value'" rule is
 * skipped in test files (fixtures are made of fake values); every provider-specific rule
 * (live keys, JWT, PEM, tokens, connection strings with a real password) still applies there.
 */
export function detectSecret(content: string, options: { isTestFile?: boolean } = {}): string | null {
  for (const rule of SECRET_RULES) {
    if (rule.pattern.test(content)) return rule.id;
  }
  CONNECTION_STRING.lastIndex = 0;
  let conn: RegExpExecArray | null;
  while ((conn = CONNECTION_STRING.exec(content)) !== null) {
    if (!PLACEHOLDER_PASSWORD.test(conn[1] ?? '')) return 'connection_string_password';
  }
  if (options.isTestFile) return null;
  ASSIGNMENT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ASSIGNMENT.exec(content)) !== null) {
    if (looksLikeCredentialValue(match[1] ?? '')) return 'credential_assignment';
  }
  return null;
}

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const PLACEHOLDER_DOMAINS = /(^|\.)(example\.(com|org|net)|test|invalid|localhost|lepefy\.com|chloefood\.com|noreply\.com)$/i;
const PLACEHOLDER_USERS = /^(noreply|no-reply|test|demo|admin|contact|support|hello|info|a|b|user)$/i;

/** Distinct real-looking e-mail addresses (placeholder domains and role mailboxes excluded). */
export function countPersonalEmails(content: string): number {
  const seen = new Set<string>();
  EMAIL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EMAIL.exec(content)) !== null) {
    const address = match[0].toLowerCase();
    const user = address.slice(0, address.indexOf('@'));
    if (PLACEHOLDER_DOMAINS.test(match[1] ?? '') || PLACEHOLDER_USERS.test(user)) continue;
    seen.add(address);
  }
  return seen.size;
}

/** Three real-looking addresses in one file is a data extract, not documentation. */
export const PERSONAL_EMAIL_THRESHOLD = 3;
/** Test fixtures legitimately carry sample addresses; a whole data extract still trips this. */
export const PERSONAL_EMAIL_THRESHOLD_TESTS = 10;

/** Rule that excludes the file given its content, or null. */
export function exclusionForContent(content: string, options: { isTestFile?: boolean } = {}): ExclusionReason | null {
  if (content.includes('\u0000')) return 'binary_content';
  if (Buffer.byteLength(content, 'utf8') > LIMITS.maxFileBytes) return 'too_large';
  if (detectSecret(content, options)) return 'secret_detected';
  if (countPersonalEmails(content) >= (options.isTestFile ? PERSONAL_EMAIL_THRESHOLD_TESTS : PERSONAL_EMAIL_THRESHOLD)) return 'personal_data';
  return null;
}
