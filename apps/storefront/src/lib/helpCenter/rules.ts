import { HELP_LIMITS, type HelpArticleLevel, type HelpLevel, type HelpStatus } from './domain';

/**
 * Pure rules of the Help Center, shared by the server, the console and the
 * tests. The SQL function help_transition_allowed (migration 174) applies the
 * same workflow: keep both in sync (parity test).
 */

export const HELP_TRANSITIONS: Readonly<Record<HelpStatus, readonly HelpStatus[]>> = {
  draft: ['review', 'archived'],
  review: ['draft', 'published', 'archived'],
  // published → published = republication (new immutable version).
  published: ['published', 'archived'],
  archived: ['draft'],
};

export function canTransition(from: HelpStatus, to: HelpStatus): boolean {
  return HELP_TRANSITIONS[from].includes(to);
}

/** Only these statuses are ever served to tenants. */
export function isServedStatus(status: HelpStatus): boolean {
  return status === 'published';
}

// ─── Access (commercial level) ───────────────────────────────────────────────

export interface HelpAccessInput {
  /** Tenant or module suspended (subscription engine). */
  suspended: boolean;
  /** Administrative kill-switch (flag help_center_disabled). */
  adminDisabled: boolean;
  /** Entitlement already merged by hasTenantFeature (explicit override beats the plan). */
  standard: boolean;
  advanced: boolean;
}

/**
 * Single resolver of the commercial level. Precedence, highest first:
 *  1. suspension               → disabled
 *  2. administrative disable   → disabled
 *  3. advanced entitlement     → advanced (implies standard)
 *  4. standard entitlement     → standard
 *  5. otherwise                → disabled
 * The explicit-override-over-plan rule lives in hasTenantFeature (entitlements);
 * a feature flag or a capability can never raise the level.
 */
export function resolveHelpLevel(input: HelpAccessInput): HelpLevel {
  if (input.suspended || input.adminDisabled) return 'disabled';
  if (input.advanced) return 'advanced';
  if (input.standard) return 'standard';
  return 'disabled';
}

export function levelAllows(level: HelpLevel, required: HelpArticleLevel): boolean {
  if (level === 'disabled') return false;
  return required === 'standard' || level === 'advanced';
}

// ─── Text ────────────────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 80 && SLUG_RE.test(value);
}

export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

const EMAIL_RE = /\S+@\S+/g;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Query as searched: trimmed, control characters dropped, bounded. */
export function cleanSearchQuery(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, HELP_LIMITS.searchMaxChars);
}

export function isSearchable(query: string): boolean {
  return (query.match(/[\p{L}\p{N}]/gu) ?? []).length >= HELP_LIMITS.searchMinChars;
}

/**
 * Term kept for « recherches sans résultat »: lower case, with anything that
 * looks personal (e-mail, uuid, long numbers, phone numbers) removed. Returns
 * null when nothing useful remains, so nothing is stored.
 */
export function minimiseSearchTerm(raw: string): string | null {
  const term = cleanSearchQuery(raw)
    .toLowerCase()
    .replace(EMAIL_RE, ' ')
    .replace(UUID_RE, ' ')
    .replace(/\+?\d[\d\s().-]{4,}\d/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return isSearchable(term) ? term : null;
}

/** Plain text extracted from blocks, for the search index. */
export function blocksSearchText(blocks: ReadonlyArray<{ type: string; text?: string; items?: string[]; alt?: string; title?: string; caption?: string }>): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.text) parts.push(block.text);
    if (block.items) parts.push(...block.items);
    if (block.alt) parts.push(block.alt);
    if (block.title) parts.push(block.title);
    if (block.caption) parts.push(block.caption);
  }
  return parts.join(' ').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 20_000);
}

export interface InlineSegment { text: string; bold: boolean }

/** `**bold**` is the only inline markup; everything else is plain text. */
export function parseInline(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  const parts = text.split('**');
  parts.forEach((part, index) => {
    if (part) out.push({ text: part, bold: index % 2 === 1 && parts.length % 2 === 1 });
  });
  return out.length ? out : [{ text: '', bold: false }];
}
