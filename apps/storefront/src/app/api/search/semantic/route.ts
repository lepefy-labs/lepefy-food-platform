import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit, logAiUsage } from '@/lib/ai/usageTracking';
import { embedText } from '@/lib/ai/embeddings';
import type { SemanticMatch } from '@lepefy/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENDPOINT = 'search-semantic';
const MODEL    = 'gemini-embedding-001';
const MAX_QUERY_LENGTH = 100;

export async function GET(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  if (!tenant.ai_semantic_search) {
    return NextResponse.json({ error: 'not_enabled' }, { status: 404 });
  }

  const allowed = await checkRateLimit(tenant.id, ENDPOINT, true);
  if (!allowed) {
    // checkRateLimit() ne logue rien lui-même (voir usageTracking.ts) — même
    // convention que les routes admin existantes : c'est à l'appelant de
    // logguer le blocage.
    await logAiUsage({
      tenantId: tenant.id,
      endpoint: ENDPOINT,
      provider: 'gemini',
      model:    MODEL,
      status:   'rate_limited',
    });
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const rawQuery = req.nextUrl.searchParams.get('q') ?? '';
  const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);

  if (query.length < 2) {
    return NextResponse.json({ error: 'query_too_short' }, { status: 400 });
  }

  try {
    const { vector, tokenCount } = await embedText(query);

    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('match_products', {
      query_embedding: vector,
      p_tenant_id:      tenant.id,
      match_count:      8,
    });

    if (error) throw new Error(error.message);

    await logAiUsage({
      tenantId:     tenant.id,
      endpoint:     ENDPOINT,
      provider:     'gemini',
      model:        MODEL,
      inputTokens:  tokenCount ?? undefined,
      outputTokens: 0,
      status:       'success',
    });

    return NextResponse.json({ results: (data ?? []) as SemanticMatch[] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    console.error('[search-semantic] Erreur:', message);
    await logAiUsage({
      tenantId: tenant.id,
      endpoint: ENDPOINT,
      provider: 'gemini',
      model:    MODEL,
      status:   'error',
    });
    return NextResponse.json({ error: 'search_failed' }, { status: 502 });
  }
}
