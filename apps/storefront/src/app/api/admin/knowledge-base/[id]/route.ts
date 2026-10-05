import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { embedText } from '@/lib/ai/embeddings';
import { logAiUsage } from '@/lib/ai/usageTracking';
import { isDismissedMarker } from '@/lib/admin/knowledgeSuggestions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ENTRY_SELECT = 'id, category, content, source, reviewed_by, reviewed_at, active, created_at';
const patchSchema = z.object({
  content: z.string().trim().min(1).max(2000).optional(),
  category: z.enum(['recipe', 'expression', 'greeting', 'cultural_context', 'faq']).optional(),
  // Paused entries stay in the base but Nala's retrieval (match_knowledge_base) ignores them.
  active: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0);

const isUuid = (value: string) => z.string().uuid().safeParse(value).success;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!isUuid(params.id) || !parsed.success) {
    return NextResponse.json({ error: 'Modification invalide (contenu de 1 à 2000 caractères).' }, { status: 400 });
  }

  const db = createServiceClient();
  const { data: current, error: readError } = await db
    .from('tenant_knowledge_base')
    .select('id, content, source')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: 'Connaissance indisponible.' }, { status: 500 });
  if (!current || isDismissedMarker(current.source)) return NextResponse.json({ error: 'Connaissance introuvable.' }, { status: 404 });

  const update: Record<string, unknown> = { ...parsed.data };
  // New text = new embedding, otherwise Nala would keep matching the old wording.
  if (parsed.data.content && parsed.data.content !== current.content) {
    try {
      const { vector, tokenCount } = await embedText(parsed.data.content);
      update.embedding = vector;
      await logAiUsage({
        tenantId: tenant.id, endpoint: 'knowledge-base-embed', provider: 'gemini', model: 'gemini-embedding-001',
        inputTokens: tokenCount ?? undefined, outputTokens: 0, status: 'success',
      });
    } catch (error) {
      console.error('[knowledge-base][PATCH] embedding failed', error instanceof Error ? error.message : error);
      await logAiUsage({ tenantId: tenant.id, endpoint: 'knowledge-base-embed', provider: 'gemini', model: 'gemini-embedding-001', status: 'error' });
      return NextResponse.json({ error: 'Modification impossible : le service d’indexation IA n’a pas répondu. Réessayez.' }, { status: 502 });
    }
  }

  const { data, error } = await db
    .from('tenant_knowledge_base')
    .update(update)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .select(ENTRY_SELECT)
    .single();
  if (error) return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  return NextResponse.json({ entry: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });

  const { error } = await createServiceClient()
    .from('tenant_knowledge_base')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: 'Suppression impossible.' }, { status: 500 });
  return NextResponse.json({ success: true });
}
