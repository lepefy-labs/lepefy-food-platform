import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { embedText } from '@/lib/ai/embeddings';
import { logAiUsage } from '@/lib/ai/usageTracking';
import type { KnowledgeBaseCategory } from '@lepefy/types';

// Route admin — dati mutabili, mai cacheable (bug noto Next.js 14.2.x sulla
// Data Cache non disattivata da force-dynamic da solo, confermato in
// produzione su evenementiel/scan/[token]/route.ts, 11/08).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export const runtime = 'nodejs';

const VALID_CATEGORIES: readonly string[] = ['recipe', 'expression', 'greeting', 'cultural_context', 'faq'];
const MAX_CONTENT_LENGTH = 2000;

/**
 * Récupère l'email de l'admin courant. Requête séparée de `requireAdmin()`
 * (qui ne l'expose pas) — même pattern cookie que `requireAdmin.ts`, juste
 * pour lire `user.email` une fois l'accès déjà validé.
 */
async function getAdminEmail(): Promise<string | null> {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
        get(name: string) { return cookieStore.get(name)?.value; },
        set() {},
        remove() {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user?.email ?? null;
}

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('tenant_knowledge_base')
    .select('id, category, content, source, reviewed_by, reviewed_at, active, created_at')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const category = typeof body?.category === 'string' ? body.category : '';
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  const source = typeof body?.source === 'string' && body.source.trim() ? body.source.trim() : 'manual';

  if (!VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'invalid_category' }, { status: 400 });
  }
  if (!content || content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json({ error: 'invalid_content' }, { status: 400 });
  }

  const adminEmail = await getAdminEmail();
  const supabase = createServiceClient();

  try {
    const { vector, tokenCount } = await embedText(content);

    const { data, error } = await supabase
      .from('tenant_knowledge_base')
      .insert({
        tenant_id: tenant.id,
        category: category as KnowledgeBaseCategory,
        content,
        embedding: vector,
        source,
        reviewed_by: adminEmail,
        reviewed_at: new Date().toISOString(),
      })
      .select('id, category, content, source, reviewed_by, reviewed_at, active, created_at')
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
    return NextResponse.json({ error: 'insert_failed' }, { status: 502 });
  }
}
