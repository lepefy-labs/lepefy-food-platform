import type { HelpArticleView, HelpContextRow, HelpLevel } from './domain';
import { levelAllows } from './rules';

/**
 * Context engine: which guides to offer for an admin page. Pure and
 * deterministic; associations come from data (help_article_contexts), never
 * from strings scattered in components. Authorisation is applied here, on the
 * server, before anything reaches the browser.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Admin pathname only: no query string, hash, foreign path or dot segment. Dynamic segments become [id]. */
export function normalizeHelpRoute(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const path = raw.split(/[?#]/)[0]!.trim().replace(/\/+$/, '') || '/';
  if (path.length > 200 || !/^\/admin(?:\/[A-Za-z0-9._~-]+)*$/.test(path)) return null;
  if (path.split('/').some((segment) => /^\.+$/.test(segment))) return null;
  return path
    .split('/')
    .map((segment) => (UUID_RE.test(segment) || /^\d{2,}$/.test(segment) ? '[id]' : segment))
    .join('/');
}

/**
 * Specificity of a pattern against a normalised route, or -1 when it does not
 * match. Exact segments win over `[id]`, a longer match over a prefix.
 * A pattern ending in `/*` matches any deeper path (module-wide guides).
 */
export function matchRoutePattern(pattern: string, route: string): number {
  const wildcard = pattern.endsWith('/*');
  const patternSegments = (wildcard ? pattern.slice(0, -2) : pattern).split('/');
  const routeSegments = route.split('/');
  if (wildcard ? routeSegments.length <= patternSegments.length : routeSegments.length !== patternSegments.length) return -1;
  let score = 0;
  for (let index = 0; index < patternSegments.length; index += 1) {
    const expected = patternSegments[index]!;
    const actual = routeSegments[index]!;
    if (expected === actual) score += 10;
    else if (expected === '[id]' && actual === '[id]') score += 10;
    else if (expected === '[id]') score += 1;
    else return -1;
  }
  return wildcard ? score : score + 5;
}

export interface HelpViewer {
  level: HelpLevel;
  permissions: ReadonlySet<string> | readonly string[];
  /** Release flags enabled for the tenant (e.g. gestion, whatsapp). */
  flags: ReadonlySet<string> | readonly string[];
  isPlatformOwner?: boolean;
}

const has = (set: ReadonlySet<string> | readonly string[], key: string) => (set instanceof Set ? set.has(key) : (set as readonly string[]).includes(key));

/** Authorisation of one article for one viewer: level, capability and flag. */
export function isArticleVisible(article: Pick<HelpArticleView, 'minLevel' | 'requiredPermission' | 'requiredFlag'>, viewer: HelpViewer): boolean {
  if (!levelAllows(viewer.level, article.minLevel)) return false;
  if (article.requiredPermission && !viewer.isPlatformOwner && !has(viewer.permissions, article.requiredPermission)) return false;
  if (article.requiredFlag && !has(viewer.flags, article.requiredFlag)) return false;
  return true;
}

export interface HelpContextInput {
  pathname: unknown;
  action?: string | null;
  articles: readonly HelpArticleView[];
  contexts: readonly HelpContextRow[];
  viewer: HelpViewer;
  /** Module of the page, used to propose related guides. */
  maxPrimary?: number;
  maxRelated?: number;
}

export interface HelpContextResult {
  /** Normalised route (null: not an admin route). */
  route: string | null;
  primary: HelpArticleView[];
  related: HelpArticleView[];
  /** True when nothing specific exists: the UI shows search and the general guide. */
  fallback: boolean;
}

export function resolveHelpContext(input: HelpContextInput): HelpContextResult {
  const route = normalizeHelpRoute(input.pathname);
  const visible = input.articles.filter((article) => isArticleVisible(article, input.viewer));
  const byId = new Map(visible.map((article) => [article.id, article]));
  const maxPrimary = input.maxPrimary ?? 5;
  const maxRelated = input.maxRelated ?? 5;
  if (!route) return { route: null, primary: [], related: [], fallback: true };

  const scores = new Map<string, number>();
  for (const context of input.contexts) {
    if (!byId.has(context.articleId)) continue;
    if (context.action && context.action !== (input.action ?? null)) continue;
    const match = matchRoutePattern(context.routePattern, route);
    if (match < 0) continue;
    // Lower priority number = shown first; specificity decides among equals.
    const score = match * 1000 - context.priority + (context.action ? 500 : 0);
    scores.set(context.articleId, Math.max(scores.get(context.articleId) ?? -Infinity, score));
  }
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || byId.get(a[0])!.position - byId.get(b[0])!.position || byId.get(a[0])!.slug.localeCompare(byId.get(b[0])!.slug))
    .map(([id]) => byId.get(id)!);
  const primary = ranked.slice(0, maxPrimary);

  // Related: same module as the primary guides, plus guides they link to, never repeated.
  const shown = new Set(primary.map((article) => article.id));
  const modules = new Set(primary.map((article) => article.module));
  const linked = new Set(primary.flatMap((article) => article.blocks.flatMap((block) => (block.type === 'related' ? [block.slug] : []))));
  const related = visible
    .filter((article) => !shown.has(article.id) && (linked.has(article.slug) || modules.has(article.module)))
    .sort((a, b) => Number(linked.has(b.slug)) - Number(linked.has(a.slug)) || a.position - b.position || a.slug.localeCompare(b.slug))
    .slice(0, maxRelated);

  return { route, primary, related, fallback: primary.length === 0 };
}

/** Locale served for a request: the article's fallback is declared by `localeUsed`. */
export function isLocaleFallback(requested: string, article: Pick<HelpArticleView, 'localeUsed'>): boolean {
  return article.localeUsed !== requested;
}
