import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { REVIEW_REASON_CODES } from '@/lib/reviews/reviewModeration';

const schema = z.object({
  action: z.enum(['publish','reject','hide','restore']),
  reasonCode: z.enum(REVIEW_REASON_CODES).nullable().optional(),
  reasonText: z.string().trim().max(500).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Action invalide.' }, { status: 400 });
  if (['reject','hide'].includes(parsed.data.action) && !parsed.data.reasonCode) {
    return NextResponse.json({ error: 'Un motif est obligatoire.' }, { status: 400 });
  }
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access) return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data: review, error } = await db.rpc('moderate_review', {
    p_tenant_id: tenant.id,
    p_review_id: params.id,
    p_action: parsed.data.action,
    p_reason_code: parsed.data.reasonCode ?? null,
    p_reason_text: parsed.data.reasonText ?? null,
    p_actor_user_id: access.userId,
  });
  if (error) {
    console.error('[reviews] moderation failed', { code: error.code, message: error.message });
    return NextResponse.json({ error: 'Impossible de modérer cet avis.' }, { status: 409 });
  }
  if (parsed.data.action === 'publish' || parsed.data.action === 'restore') {
    const row = Array.isArray(review) ? review[0] : review;
    if (row?.customer_id) {
      await db.from('customer_events').upsert({
        tenant_id: tenant.id,
        customer_id: row.customer_id,
        event_type: 'review_published',
        source: 'reviews',
        entity_type: 'review',
        entity_id: row.id,
        event_key: `review_published:${row.id}`,
        metadata: { rating: row.rating },
        occurred_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,event_key', ignoreDuplicates: true });
    }
  }
  return NextResponse.json({ ok: true, review });
}
