import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import type { AdminAccessContext } from '@/lib/auth/adminRbac';
import {
  HELP_EVENTS, HELP_LIMITS, type HelpArticleSummary, type HelpArticleView, type HelpBlock, type HelpContextRow, type HelpEvent,
  type HelpLevel, type HelpLocale,
} from '../domain';
import { countSteps } from '../blocks';
import { cleanSearchQuery, isSearchable, minimiseSearchTerm } from '../rules';
import { isArticleVisible, resolveHelpContext, type HelpContextResult, type HelpViewer } from '../contextResolver';
import { viewerFor } from './access';

/**
 * Tenant-side reads of the Help Center. Everything goes through the 174
 * projection RPCs, which return published content of this tenant (or shared)
 * only; capability, flag and level filtering is applied here, on the server.
 * Read failures degrade to « nothing found », never to an error page.
 */

interface ArticleRow {
  article_id: string; slug: string; module: string; min_level: 'standard' | 'advanced';
  required_permission: string | null; required_flag: string | null; sort_position: number; version: number;
  updated_at: string | null; locale_used: HelpLocale; title: string; summary: string; blocks: HelpBlock[];
}

function toView(row: ArticleRow): HelpArticleView {
  return {
    id: row.article_id, slug: row.slug, module: row.module, minLevel: row.min_level,
    requiredPermission: row.required_permission, requiredFlag: row.required_flag, position: row.sort_position,
    version: row.version, updatedAt: row.updated_at, localeUsed: row.locale_used, title: row.title,
    summary: row.summary, blocks: Array.isArray(row.blocks) ? row.blocks : [],
  };
}

export function toSummary(article: HelpArticleView): HelpArticleSummary {
  return {
    slug: article.slug, module: article.module, title: article.title, summary: article.summary,
    localeUsed: article.localeUsed, stepCount: countSteps(article.blocks),
  };
}

/** Release flags (of the tenant) that articles may require. */
async function enabledFlags(tenantId: string, articles: readonly Pick<HelpArticleView, 'requiredFlag'>[]): Promise<Set<string>> {
  const keys = Array.from(new Set(articles.map((article) => article.requiredFlag).filter((key): key is string => Boolean(key))));
  const results = await Promise.all(keys.map(async (key) => [key, await isFeatureEnabled(tenantId, key)] as const));
  return new Set(results.filter(([, on]) => on).map(([key]) => key));
}

async function fetchPublished(tenantId: string, locale: HelpLocale, level: HelpLevel, slug: string | null = null): Promise<HelpArticleView[]> {
  const { data, error } = await createServiceClient().rpc('help_tenant_articles', {
    p_tenant_id: tenantId, p_locale: locale, p_level: level, p_slug: slug,
  });
  if (error) {
    console.error('[help-center] articles read failed:', error.code ?? error.message);
    return [];
  }
  return ((data ?? []) as ArticleRow[]).map(toView);
}

async function fetchContexts(tenantId: string): Promise<HelpContextRow[]> {
  const { data, error } = await createServiceClient().rpc('help_tenant_contexts', { p_tenant_id: tenantId });
  if (error) {
    console.error('[help-center] contexts read failed:', error.code ?? error.message);
    return [];
  }
  return ((data ?? []) as Array<{ article_id: string; route_pattern: string; action: string | null; priority: number }>)
    .map((row) => ({ articleId: row.article_id, routePattern: row.route_pattern, action: row.action, priority: row.priority }));
}

export interface HelpScope { tenantId: string; access: AdminAccessContext; level: HelpLevel; locale: HelpLocale }

async function viewerOf(scope: HelpScope, articles: readonly HelpArticleView[]): Promise<HelpViewer> {
  return viewerFor(scope.access, scope.level, await enabledFlags(scope.tenantId, articles));
}

/** Guides for an admin page (drawer): primary, related and the fallback flag. */
export async function helpForContext(scope: HelpScope, pathname: unknown, action: string | null = null): Promise<{
  route: string | null; primary: HelpArticleSummary[]; related: HelpArticleSummary[]; fallback: boolean; localeFallback: boolean;
}> {
  const [articles, contexts] = await Promise.all([fetchPublished(scope.tenantId, scope.locale, scope.level), fetchContexts(scope.tenantId)]);
  const result: HelpContextResult = resolveHelpContext({ pathname, action, articles, contexts, viewer: await viewerOf(scope, articles) });
  return {
    route: result.route,
    primary: result.primary.map(toSummary),
    related: result.related.map(toSummary),
    fallback: result.fallback,
    localeFallback: [...result.primary, ...result.related].some((article) => article.localeUsed !== scope.locale),
  };
}

/** Every guide this admin may read, for the « Voir toutes les guides » page. */
export async function helpCatalog(scope: HelpScope): Promise<HelpArticleSummary[]> {
  const articles = await fetchPublished(scope.tenantId, scope.locale, scope.level);
  const viewer = await viewerOf(scope, articles);
  return articles.filter((article) => isArticleVisible(article, viewer))
    .sort((a, b) => a.module.localeCompare(b.module) || a.position - b.position || a.slug.localeCompare(b.slug))
    .map(toSummary);
}

/** One guide, or null: unpublished, other tenant, not authorised and unknown look identical. */
export async function helpArticle(scope: HelpScope, slug: string): Promise<{ article: HelpArticleView; related: HelpArticleSummary[]; localeFallback: boolean } | null> {
  const articles = await fetchPublished(scope.tenantId, scope.locale, scope.level);
  const viewer = await viewerOf(scope, articles);
  const article = articles.find((candidate) => candidate.slug === slug);
  if (!article || !isArticleVisible(article, viewer)) return null;
  const linked = new Set(article.blocks.flatMap((block) => (block.type === 'related' ? [block.slug] : [])));
  const related = articles.filter((candidate) => candidate.id !== article.id && linked.has(candidate.slug) && isArticleVisible(candidate, viewer)).map(toSummary);
  return { article, related, localeFallback: article.localeUsed !== scope.locale };
}

/** Text search over published guides this admin may read. Records the search (aggregate only). */
export async function helpSearch(scope: HelpScope, rawQuery: unknown): Promise<HelpArticleSummary[]> {
  const query = cleanSearchQuery(rawQuery);
  if (!isSearchable(query)) return [];
  const { data, error } = await createServiceClient().rpc('help_tenant_search', {
    p_tenant_id: scope.tenantId, p_locale: scope.locale, p_level: scope.level, p_query: query, p_limit: HELP_LIMITS.searchResults * 2,
  });
  if (error) {
    console.error('[help-center] search failed:', error.code ?? error.message);
    return [];
  }
  const rows = (data ?? []) as Array<{ article_id: string; slug: string; module: string; required_permission: string | null; required_flag: string | null; locale_used: HelpLocale; title: string; summary: string }>;
  const flags = await enabledFlags(scope.tenantId, rows.map((row) => ({ requiredFlag: row.required_flag })));
  const viewer = viewerFor(scope.access, scope.level, flags);
  const results = rows
    .filter((row) => isArticleVisible({ minLevel: 'standard', requiredPermission: row.required_permission, requiredFlag: row.required_flag }, viewer))
    .slice(0, HELP_LIMITS.searchResults)
    .map((row): HelpArticleSummary => ({ slug: row.slug, module: row.module, title: row.title, summary: row.summary, localeUsed: row.locale_used, stepCount: 0 }));
  await recordSearch(scope.tenantId, query, results.length === 0);
  return results;
}

async function recordSearch(tenantId: string, query: string, empty: boolean): Promise<void> {
  try {
    // An empty search keeps a minimised term; anything personal is dropped (rules.minimiseSearchTerm).
    const term = empty ? minimiseSearchTerm(query) : '';
    if (empty && term === null) return;
    await createServiceClient().rpc('help_record_search', { p_tenant_id: tenantId, p_term: term ?? '', p_empty: empty });
  } catch (error) {
    console.error('[help-center] search metric failed:', (error as { code?: string })?.code ?? 'unknown');
  }
}

export function isHelpEvent(value: unknown): value is HelpEvent {
  return typeof value === 'string' && (HELP_EVENTS as readonly string[]).includes(value);
}

/** Counter +1 for an article event. Only an article this admin can read counts. Never throws. */
export async function recordHelpEvent(scope: HelpScope, slug: string, event: HelpEvent): Promise<boolean> {
  try {
    const found = await helpArticle(scope, slug);
    if (!found) return false;
    const { data } = await createServiceClient().rpc('help_record_event', { p_tenant_id: scope.tenantId, p_article_id: found.article.id, p_event: event });
    return Boolean(data);
  } catch (error) {
    console.error('[help-center] event metric failed:', (error as { code?: string })?.code ?? 'unknown');
    return false;
  }
}
