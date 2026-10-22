import { ADMIN_NAV } from '@/lib/admin/navigation';
import type { SupportLinkKind, SupportResourceType, SupportStatus, SupportTenantStatus } from './domain';

/**
 * Pure rules of the Assistance module, shared by the server, the admin UI and
 * the unit tests. The SQL functions of migration 163 apply the same rules
 * (support_transition_allowed, support_tenant_status): keep both in sync.
 */

// ─── Workflow ────────────────────────────────────────────────────────────────

/** Transitions Lepefy may apply by hand (SQL support_transition_allowed). */
export const SUPPORT_TRANSITIONS: Readonly<Record<SupportStatus, readonly SupportStatus[]>> = {
  new: ['triaged', 'planned', 'in_progress', 'waiting_tenant', 'resolved', 'closed'],
  triaged: ['planned', 'in_progress', 'waiting_tenant', 'resolved', 'closed'],
  planned: ['triaged', 'in_progress', 'waiting_tenant', 'resolved', 'closed'],
  in_progress: ['planned', 'waiting_tenant', 'resolved', 'closed'],
  waiting_tenant: ['triaged', 'in_progress', 'resolved', 'closed'],
  resolved: ['in_progress', 'closed'],
  closed: ['triaged'],
};

export function canTransition(from: SupportStatus, to: SupportStatus): boolean {
  return from !== to && SUPPORT_TRANSITIONS[from].includes(to);
}

/** What the shop sees: no internal development state. */
export function tenantStatus(status: SupportStatus): SupportTenantStatus {
  if (status === 'new') return 'sent';
  if (status === 'waiting_tenant') return 'waiting_you';
  if (status === 'resolved' || status === 'closed') return 'done';
  return 'in_progress';
}

export function isOpenStatus(status: SupportStatus): boolean {
  return status !== 'resolved' && status !== 'closed';
}

/** Reopening a finished request (Lepefy « Rouvrir ») goes back to work. */
export function reopenTarget(status: SupportStatus): SupportStatus | null {
  if (status === 'resolved') return 'in_progress';
  if (status === 'closed') return 'triaged';
  return null;
}

// ─── Text ────────────────────────────────────────────────────────────────────

/**
 * Message text as stored: newlines normalised, control characters dropped,
 * runs of blank lines shortened. Rendered as plain text (never HTML).
 */
export function cleanMessageBody(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/** A request is meaningful from a few letters, not only punctuation or emoji. */
export function isMeaningfulText(text: string, min = 3): boolean {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= min;
}

// [14/10/2026 18:32] Chloé : … · 14/10/2026, 18:32 - Chloé : … (WhatsApp exports)
const CHAT_PREFIX = /^\s*\[?\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?,?\s+\d{1,2}[:h]\d{2}(?::\d{2})?\]?\s*(?:[-–]\s*)?[^:\n]{0,40}:\s*/;

/** Short deterministic title from the text: first sentence, at most 80 characters, cut on a word. */
export function deriveTitle(text: string, max = 80): string {
  const firstLine = cleanMessageBody(text).split('\n').map((line) => line.replace(CHAT_PREFIX, '').trim()).find(Boolean) ?? '';
  const sentence = (firstLine.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? firstLine).replace(/\s+/g, ' ').trim();
  const base = sentence.length >= 12 ? sentence : firstLine.replace(/\s+/g, ' ').trim();
  if (!base) return 'Demande d’assistance';
  if (base.length <= max) return base.replace(/[.!]+$/, '');
  const cut = base.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

const NUMBER = /\d+(?:[.,]\d+)?/g;

/** An AI suggestion keeps every number of the original and adds none (no invented facts). */
export function suggestionKeepsFacts(original: string, suggestion: string): boolean {
  const before = new Set(original.match(NUMBER) ?? []);
  const after = suggestion.match(NUMBER) ?? [];
  return after.every((value) => before.has(value)) && [...before].every((value) => suggestion.includes(value));
}

// ─── Context captured with a request ─────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Admin pathname only: no query string, no hash, no foreign path. */
export function sanitizeAdminPathname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const path = raw.split(/[?#]/)[0]!.trim().replace(/\/+$/, '') || '/';
  if (path.length > 200 || !/^\/admin(?:\/[A-Za-z0-9._~-]+)*$/.test(path)) return null;
  // No dot segment (« .. » could point outside /admin once resolved).
  if (path.split('/').some((segment) => /^\.+$/.test(segment))) return null;
  return path;
}

/** Route pattern without ids: kept with the request and shown to Lepefy. */
export function routePattern(pathname: string): string {
  return pathname.split('/').map((segment) => (UUID_RE.test(segment) || /^\d{2,}$/.test(segment) ? '[id]' : segment)).join('/');
}

/** French name of the admin page (navigation registry), e.g. « Commandes ». */
export function pageLabelForPath(pathname: string): string {
  if (pathname === '/admin' || pathname === '/admin/') return 'Aujourd’hui';
  if (pathname.startsWith('/admin/assistance')) return 'Assistance';
  if (pathname.startsWith('/admin/platform')) return 'Console Lepefy';
  let best: { label: string; length: number } | null = null;
  for (const item of ADMIN_NAV) {
    // A child at the entry's own href (« Toutes les commandes ») keeps the module name.
    const candidates = [{ href: item.href, label: item.label }, ...(item.children ?? []).filter((child) => child.href !== item.href)];
    for (const candidate of candidates) {
      if (candidate.href === '/admin') continue;
      if ((pathname === candidate.href || pathname.startsWith(`${candidate.href}/`)) && (!best || candidate.href.length > best.length)) {
        best = { label: candidate.label, length: candidate.href.length };
      }
    }
  }
  return best?.label ?? 'Administration';
}

/** Resource of a detail page (verified on the server before it is kept). */
export function resourceFromPath(pathname: string): { type: SupportResourceType; id: string } | null {
  const match = /^\/admin\/(orders|catalogue|clients)\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname);
  if (!match || !UUID_RE.test(match[2]!)) return null;
  const type: SupportResourceType = match[1] === 'orders' ? 'order' : match[1] === 'catalogue' ? 'product' : 'customer';
  return { type, id: match[2]!.toLowerCase() };
}

export interface DeviceSummary { device: 'mobile' | 'tablet' | 'desktop'; os: string; browser: string }

/** Essential device facts only, never the raw user agent. */
export function deviceFromUserAgent(ua: string | null | undefined): DeviceSummary {
  const value = (ua ?? '').slice(0, 400);
  const tablet = /iPad|Tablet|(Android(?!.*Mobile))/i.test(value);
  const mobile = !tablet && /Mobi|iPhone|iPod|Android/i.test(value);
  const os = /iPhone|iPad|iPod/i.test(value) ? 'iOS'
    : /Android/i.test(value) ? 'Android'
    : /Windows/i.test(value) ? 'Windows'
    : /Mac OS X|Macintosh/i.test(value) ? 'macOS'
    : /CrOS/i.test(value) ? 'ChromeOS'
    : /Linux/i.test(value) ? 'Linux' : 'Autre';
  const browser = /Edg\//.test(value) ? 'Edge'
    : /SamsungBrowser/i.test(value) ? 'Samsung Internet'
    : /Firefox|FxiOS/i.test(value) ? 'Firefox'
    : /Chrome|CriOS/i.test(value) ? 'Chrome'
    : /Safari/i.test(value) ? 'Safari' : 'Autre';
  return { device: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop', os, browser };
}

export function normalizeLocale(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(value) ? value : null;
}

export interface SupportContext {
  page_label?: string;
  route?: string;
  locale?: string;
  device?: DeviceSummary['device'];
  os?: string;
  browser?: string;
  app_version?: string;
  viewport?: string;
}

/**
 * Context kept with a request: page name, route pattern, language, device,
 * build. Nothing else: no query string, token, page content or other tenant.
 */
export function buildSupportContext(input: {
  pathname: string | null;
  pageLabel?: string | null;
  locale?: unknown;
  userAgent?: string | null;
  appVersion?: string | null;
  viewport?: unknown;
}): SupportContext {
  const context: SupportContext = {};
  if (input.pathname) {
    context.route = routePattern(input.pathname);
    context.page_label = (input.pageLabel ?? pageLabelForPath(input.pathname)).slice(0, 60);
  }
  const locale = normalizeLocale(input.locale);
  if (locale) context.locale = locale;
  const device = deviceFromUserAgent(input.userAgent);
  context.device = device.device;
  context.os = device.os;
  context.browser = device.browser;
  if (input.appVersion && /^[0-9a-f]{7,40}$/i.test(input.appVersion)) context.app_version = input.appVersion.slice(0, 7);
  if (typeof input.viewport === 'string' && /^\d{2,5}x\d{2,5}$/.test(input.viewport)) context.viewport = input.viewport;
  return context;
}

// ─── Notifications ───────────────────────────────────────────────────────────

/** One notification per request and per window: replies sent in a burst share a key. */
export function notificationWindow(date: Date, minutes = 15): string {
  const slot = Math.floor(date.getTime() / (minutes * 60_000));
  return `${minutes}m-${slot}`;
}

// ─── GitHub links ────────────────────────────────────────────────────────────

const GITHUB_LINK = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues\/(\d+)|pull\/(\d+)|commit\/([0-9a-f]{7,40})|releases\/tag\/([A-Za-z0-9_.-]+))$/;

/** Verified GitHub reference (SQL CHECK support_links.url): kind + default label. */
export function parseGithubLink(raw: unknown): { url: string; kind: SupportLinkKind; label: string } | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (url.length > 300) return null;
  const match = GITHUB_LINK.exec(url);
  if (!match) return null;
  const [, , repo, , issue, pull, commit, tag] = match;
  if (issue) return { url, kind: 'issue', label: `${repo}#${issue}` };
  if (pull) return { url, kind: 'pull_request', label: `${repo} PR #${pull}` };
  if (commit) return { url, kind: 'commit', label: `${repo}@${commit.slice(0, 7)}` };
  return { url, kind: 'release', label: `${repo} ${tag}` };
}
