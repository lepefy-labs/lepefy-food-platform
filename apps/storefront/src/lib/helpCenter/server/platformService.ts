import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import {
  HELP_LOCALES, HELP_MODULES, HELP_STATUSES, type HelpArticleLevel, type HelpBlock, type HelpLocale, type HelpStatus,
} from '../domain';
import { parseBlocks } from '../blocks';
import { blocksSearchText, isValidSlug } from '../rules';

/**
 * Platform-owner side of the Help Center: authoring, workflow, revisions and
 * metrics. Callers must have passed helpPlatformApi() / the platform layout.
 * Errors from the 174 RPCs are `help_*` codes mapped to French messages.
 */

export const HELP_ERRORS: Record<string, string> = {
  help_article_not_found: 'Article introuvable.',
  help_status_conflict: 'Cet article a été modifié entre-temps : rechargez la page.',
  help_transition_forbidden: 'Ce changement de statut n’est pas autorisé.',
  help_missing_french_content: 'La version française doit avoir un contenu avant publication.',
  help_revision_not_found: 'Révision introuvable.',
};

export function helpErrorMessage(error: unknown): string {
  const message = typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : '';
  const code = Object.keys(HELP_ERRORS).find((key) => message.includes(key));
  if ((error as { code?: string })?.code === '23505') return 'Ce slug est déjà utilisé.';
  return code ? HELP_ERRORS[code]! : 'Opération impossible pour le moment.';
}

export interface ArticleRecord {
  id: string; tenant_id: string | null; slug: string; module: string; min_level: HelpArticleLevel;
  required_permission: string | null; required_flag: string | null; status: HelpStatus; version: number;
  published_version: number | null; position: number; reviewed_at: string | null; published_at: string | null;
  updated_at: string; created_at: string; last_editor_id: string | null; reviewed_by: string | null;
}

export interface TranslationRecord { locale: HelpLocale; title: string; summary: string; blocks: HelpBlock[]; updated_at: string }
export interface ContextRecord { id: string; route_pattern: string; action: string | null; priority: number }
export interface RevisionRecord { version: number; locale: HelpLocale; title: string; note: string | null; created_at: string; published_by: string | null }

const COLUMNS = 'id, tenant_id, slug, module, min_level, required_permission, required_flag, status, version, published_version, position, reviewed_at, published_at, updated_at, created_at, last_editor_id, reviewed_by';

export interface ArticleListFilters { search?: string; status?: HelpStatus | null; module?: string | null; page?: number; size?: number }

export async function listArticles(filters: ArticleListFilters): Promise<{ rows: Array<ArticleRecord & { title: string; locales: HelpLocale[] }>; total: number }> {
  const db = createServiceClient();
  const size = Math.min(Math.max(filters.size ?? 25, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  let query = db.from('help_articles').select(COLUMNS, { count: 'exact' });
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.module) query = query.eq('module', filters.module);
  if (filters.search) {
    // Escaped for PostgREST: commas and parentheses would break the or() grammar.
    const safe = filters.search.replace(/[,()%*\\]/g, ' ').trim().slice(0, 60);
    if (safe) query = query.or(`slug.ilike.%${safe}%,module.ilike.%${safe}%`);
  }
  const { data, count, error } = await query.order('module').order('position').order('slug').range((page - 1) * size, page * size - 1);
  if (error) throw new Error(`help articles: ${error.code ?? error.message}`);
  const articles = (data ?? []) as ArticleRecord[];
  const ids = articles.map((article) => article.id);
  const translations = ids.length
    ? ((await db.from('help_article_translations').select('article_id, locale, title').in('article_id', ids)).data ?? []) as Array<{ article_id: string; locale: HelpLocale; title: string }>
    : [];
  return {
    total: count ?? 0,
    rows: articles.map((article) => {
      const mine = translations.filter((translation) => translation.article_id === article.id);
      return { ...article, title: mine.find((translation) => translation.locale === 'fr')?.title ?? mine[0]?.title ?? article.slug, locales: mine.map((translation) => translation.locale) };
    }),
  };
}

export async function statusCounts(): Promise<Record<HelpStatus, number>> {
  const counts = { draft: 0, review: 0, published: 0, archived: 0 } as Record<HelpStatus, number>;
  const db = createServiceClient();
  await Promise.all(HELP_STATUSES.map(async (status) => {
    const { count } = await db.from('help_articles').select('id', { count: 'exact', head: true }).eq('status', status);
    counts[status] = count ?? 0;
  }));
  return counts;
}

export async function loadArticle(id: string): Promise<{ article: ArticleRecord; translations: TranslationRecord[]; contexts: ContextRecord[]; revisions: RevisionRecord[] } | null> {
  const db = createServiceClient();
  const { data: article } = await db.from('help_articles').select(COLUMNS).eq('id', id).maybeSingle();
  if (!article) return null;
  const [translations, contexts, revisions] = await Promise.all([
    db.from('help_article_translations').select('locale, title, summary, blocks, updated_at').eq('article_id', id),
    db.from('help_article_contexts').select('id, route_pattern, action, priority').eq('article_id', id).order('priority'),
    db.from('help_article_revisions').select('version, locale, title, note, created_at, published_by').eq('article_id', id).order('version', { ascending: false }),
  ]);
  return {
    article: article as ArticleRecord,
    translations: (translations.data ?? []) as TranslationRecord[],
    contexts: (contexts.data ?? []) as ContextRecord[],
    revisions: (revisions.data ?? []) as RevisionRecord[],
  };
}

export interface ArticleInput {
  slug: string; module: string; minLevel: HelpArticleLevel; requiredPermission: string | null; requiredFlag: string | null;
  position: number; tenantId: string | null;
}

/** Validates the metadata of an article (console form); returns an error message or null. */
export function validateArticleInput(input: Partial<ArticleInput>, creating: boolean): string | null {
  if (creating && !isValidSlug(input.slug)) return 'Slug invalide (minuscules, chiffres et tirets).';
  if (input.module !== undefined && !/^[a-z0-9_-]{2,40}$/.test(input.module)) return 'Module invalide.';
  if (input.minLevel !== undefined && input.minLevel !== 'standard' && input.minLevel !== 'advanced') return 'Niveau invalide.';
  if (input.requiredPermission && !/^[a-z_]+\.[a-z_]+$/.test(input.requiredPermission)) return 'Permission invalide.';
  if (input.requiredFlag && !/^[a-z0-9_]{2,60}$/.test(input.requiredFlag)) return 'Flag invalide.';
  return null;
}

export async function createArticle(input: ArticleInput, title: string, actorId: string): Promise<{ id: string }> {
  const db = createServiceClient();
  const { data, error } = await db.from('help_articles').insert({
    slug: input.slug, module: input.module, min_level: input.minLevel, required_permission: input.requiredPermission,
    required_flag: input.requiredFlag, position: input.position, tenant_id: input.tenantId, last_editor_id: actorId,
  }).select('id').single();
  if (error || !data) throw error ?? new Error('create failed');
  const { error: translationError } = await db.from('help_article_translations').insert({ article_id: data.id, locale: 'fr', title: title.slice(0, 160), summary: '', blocks: [], search_text: '' });
  if (translationError) throw translationError;
  return { id: data.id as string };
}

export async function updateMetadata(id: string, patch: Partial<ArticleInput>, actorId: string): Promise<void> {
  const row: Record<string, unknown> = { last_editor_id: actorId, updated_at: new Date().toISOString() };
  if (patch.module !== undefined) row.module = patch.module;
  if (patch.minLevel !== undefined) row.min_level = patch.minLevel;
  if (patch.requiredPermission !== undefined) row.required_permission = patch.requiredPermission || null;
  if (patch.requiredFlag !== undefined) row.required_flag = patch.requiredFlag || null;
  if (patch.position !== undefined) row.position = patch.position;
  const { error } = await createServiceClient().from('help_articles').update(row).eq('id', id);
  if (error) throw error;
}

export type SaveTranslationResult = { ok: true } | { ok: false; error: string };

/** Saves the working copy of one language. Blocks are validated; the search text is derived. */
export async function saveTranslation(id: string, locale: HelpLocale, title: string, summary: string, rawBlocks: unknown, actorId: string): Promise<SaveTranslationResult> {
  if (!(HELP_LOCALES as readonly string[]).includes(locale)) return { ok: false, error: 'Langue invalide.' };
  const cleanTitle = title.trim();
  if (!cleanTitle || cleanTitle.length > 160) return { ok: false, error: 'Titre requis (160 caractères maximum).' };
  if (summary.length > 400) return { ok: false, error: 'Résumé trop long (400 caractères maximum).' };
  const parsed = parseBlocks(rawBlocks);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const db = createServiceClient();
  const { error } = await db.from('help_article_translations').upsert({
    article_id: id, locale, title: cleanTitle, summary: summary.trim(), blocks: parsed.blocks,
    search_text: blocksSearchText(parsed.blocks as never), updated_at: new Date().toISOString(),
  }, { onConflict: 'article_id,locale' });
  if (error) throw error;
  await db.from('help_articles').update({ last_editor_id: actorId, updated_at: new Date().toISOString() }).eq('id', id);
  return { ok: true };
}

const ROUTE_PATTERN_RE = /^\/admin(\/[a-zA-Z0-9._~[\]-]+)*(\/\*)?$/;

export async function replaceContexts(id: string, contexts: Array<{ routePattern: string; action?: string | null; priority?: number }>): Promise<SaveTranslationResult> {
  const clean = contexts.slice(0, 30).map((context) => ({
    article_id: id, route_pattern: String(context.routePattern ?? '').trim(),
    action: context.action ? String(context.action) : null,
    priority: Number.isInteger(context.priority) ? Math.min(Math.max(context.priority!, 0), 1000) : 100,
  }));
  if (clean.some((context) => !ROUTE_PATTERN_RE.test(context.route_pattern) || context.route_pattern.length > 200 || (context.action && !/^[a-z_]{2,40}$/.test(context.action)))) {
    return { ok: false, error: 'Page associée invalide (ex. /admin/orders ou /admin/orders/[id]).' };
  }
  const db = createServiceClient();
  const { error: deleteError } = await db.from('help_article_contexts').delete().eq('article_id', id);
  if (deleteError) throw deleteError;
  if (clean.length) {
    const { error } = await db.from('help_article_contexts').insert(clean);
    if (error) throw error;
  }
  return { ok: true };
}

export async function setArticleStatus(id: string, to: HelpStatus, expected: HelpStatus | null, actorId: string, note: string | null) {
  const { data, error } = await createServiceClient().rpc('help_set_status', { p_article_id: id, p_to: to, p_expected: expected, p_actor: actorId, p_note: note });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as { out_status: HelpStatus; out_version: number; out_published_version: number | null };
}

export async function restoreRevision(id: string, version: number, actorId: string): Promise<void> {
  const { error } = await createServiceClient().rpc('help_restore_revision', { p_article_id: id, p_version: version, p_actor: actorId });
  if (error) throw error;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface HelpMetrics {
  windowDays: number;
  popular: Array<{ articleId: string; slug: string; views: number; helpful: number; notHelpful: number; supportOpened: number }>;
  emptySearches: Array<{ term: string; total: number }>;
  searches: { total: number; empty: number };
}

export async function helpMetrics(windowDays = 30): Promise<HelpMetrics> {
  const db = createServiceClient();
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const [events, searches] = await Promise.all([
    db.from('help_article_daily').select('article_id, event, total').gte('day', since).limit(20_000),
    db.from('help_search_daily').select('term, empty, total').gte('day', since).limit(20_000),
  ]);
  const perArticle = new Map<string, { views: number; helpful: number; notHelpful: number; supportOpened: number }>();
  for (const row of (events.data ?? []) as Array<{ article_id: string; event: string; total: number }>) {
    const entry = perArticle.get(row.article_id) ?? { views: 0, helpful: 0, notHelpful: 0, supportOpened: 0 };
    if (row.event === 'view') entry.views += row.total;
    else if (row.event === 'helpful') entry.helpful += row.total;
    else if (row.event === 'not_helpful') entry.notHelpful += row.total;
    else if (row.event === 'support_opened') entry.supportOpened += row.total;
    perArticle.set(row.article_id, entry);
  }
  const ids = [...perArticle.keys()];
  const slugs = ids.length ? ((await db.from('help_articles').select('id, slug').in('id', ids)).data ?? []) as Array<{ id: string; slug: string }> : [];
  const slugOf = new Map(slugs.map((row) => [row.id, row.slug]));
  const popular = ids.map((articleId) => ({ articleId, slug: slugOf.get(articleId) ?? articleId, ...perArticle.get(articleId)! })).sort((a, b) => b.views - a.views).slice(0, 25);
  const empties = new Map<string, number>();
  let total = 0;
  let empty = 0;
  for (const row of (searches.data ?? []) as Array<{ term: string; empty: boolean; total: number }>) {
    total += row.total;
    if (row.empty) { empty += row.total; if (row.term) empties.set(row.term, (empties.get(row.term) ?? 0) + row.total); }
  }
  return {
    windowDays, popular, searches: { total, empty },
    emptySearches: [...empties.entries()].map(([term, count]) => ({ term, total: count })).sort((a, b) => b.total - a.total).slice(0, 25),
  };
}

/** Opportunistic retention (180 days): never blocks the page. */
export async function purgeOldMetrics(): Promise<void> {
  try { await createServiceClient().rpc('help_purge_metrics'); } catch { /* best effort */ }
}

export const HELP_MODULE_KEYS = Object.keys(HELP_MODULES);
