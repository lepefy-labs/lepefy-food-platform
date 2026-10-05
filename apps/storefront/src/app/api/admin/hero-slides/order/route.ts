import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { reorderPositions } from '@/lib/home/heroSlideRules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).strict();

// Rewrites every position from one complete ordered list (a carousel holds a
// handful of slides). Replaces the former pair of parallel position swaps,
// which could leave two slides on the same position when one request failed.
async function handlePUT(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Ordre invalide.' }, { status: 400 });

  const db = createServiceClient();
  const { data: current, error } = await db.from('tenant_hero_slides').select('id').eq('tenant_id', tenant.id);
  if (error) return NextResponse.json({ error: 'Slides indisponibles.' }, { status: 500 });

  const positions = reorderPositions((current ?? []).map((row) => row.id as string), parsed.data.ids);
  if (!positions) return NextResponse.json({ error: 'La liste des slides a changé. Rechargez la page.' }, { status: 409 });

  for (const { id, position } of positions) {
    const { error: updateError } = await db.from('tenant_hero_slides').update({ position }).eq('id', id).eq('tenant_id', tenant.id);
    if (updateError) {
      console.error('[hero-slides] reorder failed', updateError.message);
      return NextResponse.json({ error: 'Réorganisation interrompue. Rechargez la page.' }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}

export const PUT = withStorefrontInvalidation(['catalog'], handlePUT);
