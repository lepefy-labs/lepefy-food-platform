import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { INITIAL_LIBRARY } from '@/lib/helpCenter/library/initialLibrary';
import { blocksSearchText } from '@/lib/helpCenter/rules';
import { parseBlocks } from '@/lib/helpCenter/blocks';
import { helpPlatformApi } from '@/lib/helpCenter/server/access';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/platform/knowledge/import-library — creates the initial
 * French guides as DRAFTS. Idempotent: a slug that already exists is skipped
 * (never overwritten) and nothing is ever published here: publication is an
 * explicit editorial action in the console. Platform owner only.
 */
export async function POST() {
  const guard = await helpPlatformApi();
  if (!guard.ok) return guard.response;
  const db = createServiceClient();
  const { data: existing, error: readError } = await db.from('help_articles').select('slug').is('tenant_id', null);
  if (readError) return NextResponse.json({ error: 'Lecture impossible. La migration 174 est-elle appliquée ?' }, { status: 503 });
  const known = new Set((existing ?? []).map((row: { slug: string }) => row.slug));

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
    created += 1;
  }
  return NextResponse.json({ created, skipped });
}
