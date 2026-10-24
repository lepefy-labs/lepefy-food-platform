import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { embedText } from '@/lib/ai/embeddings';
import { logAiUsage } from '@/lib/ai/usageTracking';
import {
  KNOWLEDGE_DISMISSED_SOURCE_PREFIX,
  KNOWLEDGE_SUGGESTION_SOURCE_PREFIX,
  knowledgeDismissedSource,
  knowledgeSuggestionSource,
} from '@/lib/admin/knowledgeSuggestions';
import type { KnowledgeBaseCategory } from '@lepefy/types';
import { knowledgeFingerprint, knowledgeIssue } from '@/lib/admin/knowledgeSafety';
import { loadKnowledgeBaseSuggestions } from '@/lib/admin/knowledgeSuggestions';
import { KNOWLEDGE_ENTRY_SELECT, getKnowledgeAdminEmail } from '@/lib/admin/knowledgeApi';
import { missingKnowledgeSchema } from '@/lib/admin/knowledgeSchema';

// Route admin — dati mutabili, mai cacheable (bug noto Next.js 14.2.x sulla
// Data Cache non disattivata da force-dynamic da solo, confermato in
// produzione su evenementiel/scan/[token]/route.ts, 11/08).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export const runtime = 'nodejs';

const VALID_CATEGORIES: readonly string[] = ['recipe', 'expression', 'greeting', 'cultural_context', 'faq'];
const SUGGESTION_KEY_PATTERN = /^[a-f0-9]{24}$/;

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const page = Math.max(1, Math.min(10000, Number(req.nextUrl.searchParams.get('page')) || 1));
  const pageSize = 20;
  const search = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100).replace(/[%_,]/g, ' ');
  const category = req.nextUrl.searchParams.get('category') ?? '';
  const status = req.nextUrl.searchParams.get('status') ?? '';
  let query = supabase
    .from('tenant_knowledge_base')
    .select(KNOWLEDGE_ENTRY_SELECT, { count: 'exact' })
    .eq('tenant_id', tenant.id)
    .is('deleted_at', null).or('source.is.null,source.not.like.nala_dismissed:%');
  if (search) query = query.or(`content.ilike.%${search}%,title.ilike.%${search}%`);
  if (VALID_CATEGORIES.includes(category)) query = query.eq('category', category);
  if (status === 'active' || status === 'paused') query = query.eq('active', status === 'active');
  const { data, count, error } = await query.order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);

  if (error) {
    if (missingKnowledgeSchema(error)) {
      const { data: legacy, error: legacyError } = await supabase.from('tenant_knowledge_base')
        .select('id, category, content, source, reviewed_by, reviewed_at, active, created_at')
        .eq('tenant_id', tenant.id).order('created_at', { ascending: false });
      if (!legacyError) {
        const entries = (legacy ?? []).filter((entry) => !entry.source?.startsWith(KNOWLEDGE_DISMISSED_SOURCE_PREFIX));
        return NextResponse.json({ entries, total: entries.length, page: 1, pageSize: entries.length });
      }
    }
    return NextResponse.json({ error: 'Chargement impossible.' }, { status: 500 });
  }

  return NextResponse.json({ entries: data ?? [], total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null);

  // « Ignorer » : inactive marker without embedding, so the suggestion is never proposed again.
  const dismissKey = typeof body?.dismissSuggestionKey === 'string' ? body.dismissSuggestionKey.trim() : '';
  if (dismissKey) {
    if (!SUGGESTION_KEY_PATTERN.test(dismissKey)) return NextResponse.json({ error: 'Suggestion inconnue.' }, { status: 400 });
    const db = createServiceClient();
    const source = knowledgeDismissedSource(dismissKey);
    const { data: existing } = await db.from('tenant_knowledge_base').select('id').eq('tenant_id', tenant.id).eq('source', source).maybeSingle();
    if (!existing) {
      const { error } = await db.from('tenant_knowledge_base').insert({
        tenant_id: tenant.id, category: 'faq', content: 'Suggestion ignorée', embedding: null, source,
        active: false, reviewed_by: await getKnowledgeAdminEmail(), reviewed_at: new Date().toISOString(),
      });
      if (error) return NextResponse.json({ error: 'Impossible d’ignorer cette suggestion.' }, { status: 500 });
    }
    return NextResponse.json({ dismissed: true });
  }

  const category = typeof body?.category === 'string' ? body.category : '';
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const rawSuggestionKey = typeof body?.suggestionKey === 'string' ? body.suggestionKey.trim() : '';

  if (!VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'Catégorie invalide.' }, { status: 400 });
  }
  const issue = knowledgeIssue(content);
  if (issue) return NextResponse.json({ error: issue }, { status: 400 });
  if (title.length > 160) return NextResponse.json({ error: 'Titre trop long.' }, { status: 400 });
  if (rawSuggestionKey && !SUGGESTION_KEY_PATTERN.test(rawSuggestionKey)) {
    return NextResponse.json({ error: 'Suggestion inconnue.' }, { status: 400 });
  }

  const manualSource = typeof body?.source === 'string' && body.source.trim()
    ? body.source.trim()
    : 'manual';
  const source = rawSuggestionKey
    ? knowledgeSuggestionSource(rawSuggestionKey)
    : manualSource.startsWith(KNOWLEDGE_SUGGESTION_SOURCE_PREFIX) || manualSource.startsWith(KNOWLEDGE_DISMISSED_SOURCE_PREFIX) || manualSource.startsWith('library:') ? 'manual' : manualSource.slice(0, 120);

  const adminEmail = await getKnowledgeAdminEmail();
  const supabase = createServiceClient();
  const { error: schemaError } = await supabase.from('knowledge_library').select('id', { head: true }).limit(1);
  if (schemaError && !missingKnowledgeSchema(schemaError)) return NextResponse.json({ error: 'Base de connaissance indisponible.' }, { status: 503 });
  const legacySchema = Boolean(schemaError);

  try {
    if (rawSuggestionKey) {
      const { data: sources } = await supabase.from('tenant_knowledge_base').select('source').eq('tenant_id', tenant.id);
      const candidates = await loadKnowledgeBaseSuggestions({ supabase, tenantId: tenant.id, existingSources: (sources ?? []).map((row) => row.source) });
      if (!candidates.some((item) => item.key === rawSuggestionKey)) {
        return NextResponse.json({ error: 'Cette suggestion n’est plus disponible.' }, { status: 409 });
      }
    }
    let existingQuery = supabase.from('tenant_knowledge_base').select('content').eq('tenant_id', tenant.id);
    if (!legacySchema) existingQuery = existingQuery.is('deleted_at', null);
    const { data: currentTexts, error: textsError } = await existingQuery;
    if (textsError) throw new Error(textsError.message);
    if ((currentTexts ?? []).some((row) => knowledgeFingerprint(row.content) === knowledgeFingerprint(content))) {
      return NextResponse.json({ error: 'Cette connaissance existe déjà.' }, { status: 409 });
    }
    if (rawSuggestionKey) {
      const { data: existing, error: existingError } = await supabase
        .from('tenant_knowledge_base')
        .select(legacySchema ? 'id, category, content, source, reviewed_by, reviewed_at, active, created_at' : KNOWLEDGE_ENTRY_SELECT)
        .eq('tenant_id', tenant.id)
        .eq('source', source)
        .maybeSingle();

      if (existingError) throw new Error(existingError.message);
      if (existing) {
        return NextResponse.json({ entry: existing, alreadyExists: true });
      }
    }

    const { vector, tokenCount } = await embedText(content);

    const { data, error } = await supabase
      .from('tenant_knowledge_base')
      .insert({
        tenant_id: tenant.id,
        ...(!legacySchema ? { title: title || null, modified_by: adminEmail } : {}),
        category: category as KnowledgeBaseCategory,
        content,
        embedding: vector,
        source,
        reviewed_by: adminEmail,
        reviewed_at: new Date().toISOString(),
      })
      .select(legacySchema ? 'id, category, content, source, reviewed_by, reviewed_at, active, created_at' : KNOWLEDGE_ENTRY_SELECT)
      .single();

    if (error) throw new Error(error.message);

    await logAiUsage({
      tenantId: tenant.id,
      endpoint: 'knowledge-base-embed',
      provider: 'gemini',
      model: 'gemini-embedding-001',
      inputTokens: tokenCount ?? undefined,
      outputTokens: 0,
      status: 'success',
    });

    return NextResponse.json({ entry: data }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[knowledge-base][POST] Erreur:', message);
    await logAiUsage({
      tenantId: tenant.id,
      endpoint: 'knowledge-base-embed',
      provider: 'gemini',
      model: 'gemini-embedding-001',
      status: 'error',
    });
    return NextResponse.json({ error: 'Ajout impossible : le service d’indexation IA n’a pas répondu. Réessayez.' }, { status: 502 });
  }
}
