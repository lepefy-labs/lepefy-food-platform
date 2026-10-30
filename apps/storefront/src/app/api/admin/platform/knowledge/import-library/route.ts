import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { INITIAL_LIBRARY } from '@/lib/helpCenter/library/initialLibrary';
import { LIBRARY_TRANSLATIONS } from '@/lib/helpCenter/library/translations';
import { blocksSearchText } from '@/lib/helpCenter/rules';
import { parseBlocks } from '@/lib/helpCenter/blocks';
import { helpPlatformApi } from '@/lib/helpCenter/server/access';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/platform/knowledge/import-library — creates the initial
 * French guides as DRAFTS and adds the missing Italian / English working
 * copies of library guides. Idempotent: an article or a translation that
 * already exists is never overwritten, and nothing is ever published here
 * (translations of a published guide reach tenants only after a republication):
 * publication is an explicit editorial action. Platform owner only.
 */
export async function POST() {
  const guard = await helpPlatformApi();
  if (!guard.ok) return guard.response;
  const db = createServiceClient();
  const { data: existing, error: readError } = await db.from('help_articles').select('id, slug').is('tenant_id', null);
  if (readError) return NextResponse.json({ error: 'Lecture impossible. La migration 174 est-elle appliquée ?' }, { status: 503 });
  const known = new Set((existing ?? []).map((row: { slug: string }) => row.slug));
  const idBySlug = new Map((existing ?? []).map((row: { id: string; slug: string }) => [row.slug, row.id]));

  let created = 0;
  const skipped: string[] = [];
  for (const [index, guide] of INITIAL_LIBRARY.entries()) {
    if (known.has(guide.slug)) { skipped.push(guide.slug); continue; }
    const parsed = parseBlocks(guide.blocks);
    if (!parsed.ok) return NextResponse.json({ error: `Guide « ${guide.slug} » invalide : ${parsed.error}` }, { status: 500 });
    const { data: article, error } = await db.from('help_articles').insert({
      slug: guide.slug, module: guide.module, min_level: 'standard',
      required_permission: guide.requiredPermission ?? null, required_flag: guide.requiredFlag ?? null,
      status: 'draft', position: (index + 1) * 10, last_editor_id: guard.adminId, tenant_id: null,
    }).select('id').single();
    if (error || !article) { skipped.push(guide.slug); continue; }
    const { error: translationError } = await db.from('help_article_translations').insert({
      article_id: article.id, locale: 'fr', title: guide.title, summary: guide.summary, blocks: parsed.blocks,
      search_text: blocksSearchText(parsed.blocks as never),
    });
    if (translationError) { await db.from('help_articles').delete().eq('id', article.id); skipped.push(guide.slug); continue; }
    await db.from('help_article_contexts').insert(guide.contexts.map((routePattern, order) => ({ article_id: article.id, route_pattern: routePattern, priority: (order + 1) * 10 })));
    idBySlug.set(guide.slug, article.id as string);
    created += 1;
  }

  // Missing IT / EN working copies for every library guide (never overwrites an existing translation).
  let translationsAdded = 0;
  for (const guide of INITIAL_LIBRARY) {
    const articleId = idBySlug.get(guide.slug);
    const translations = LIBRARY_TRANSLATIONS[guide.slug];
    if (!articleId || !translations) continue;
    for (const locale of ['it', 'en'] as const) {
      const t = translations[locale];
      const parsed = parseBlocks(t.blocks);
      if (!parsed.ok) continue;
      const { data: added } = await db.from('help_article_translations').upsert(
        { article_id: articleId, locale, title: t.title, summary: t.summary, blocks: parsed.blocks, search_text: blocksSearchText(parsed.blocks as never) },
        { onConflict: 'article_id,locale', ignoreDuplicates: true },
      ).select('locale');
      translationsAdded += added?.length ?? 0;
    }
  }
  return NextResponse.json({ created, skipped, translationsAdded });
}
