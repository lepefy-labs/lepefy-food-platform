import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { CANCEL_NOTE_PREFIX, cancelRequestSchema } from '@/lib/ambassador/ambassadorAdmin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// « Annuler » — for a referred order refunded or returned after delivery.
// Only a CONFIRMED commission can be cancelled (a paid one was already
// transferred). The unique (tenant, referred customer) row stays: the
// referred customer never generates a second commission.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const parsed = cancelRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Indiquez le motif de l’annulation (3 caractères minimum).' }, { status: 400 });
  }

  const { data, error } = await createServiceClient()
    .from('ambassador_commissions')
    .update({ status: 'CANCELLED', payment_note: `${CANCEL_NOTE_PREFIX}${parsed.data.reason}` })
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('status', 'CONFIRMED')
    .select('id, status, payment_note')
    .maybeSingle();

  if (error) {
    console.error('[ambassador commission cancel] update failed', tenant.id, error);
    return NextResponse.json({ error: 'Annulation impossible pour le moment.' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Commission introuvable, déjà versée ou déjà annulée.' }, { status: 409 });
  }
  return NextResponse.json(data);
}
