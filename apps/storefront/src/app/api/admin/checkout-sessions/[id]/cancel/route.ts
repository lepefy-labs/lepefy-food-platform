import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: session, error: sessionError } = await supabase
    .from('checkout_sessions')
    .select('id, status, payment_method, order_id')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('payment_method', 'external_link')
    .in('status', ['open', 'expired', 'awaiting_verification'])
    .maybeSingle();

  if (sessionError) {
    console.error('[admin/checkout-sessions/cancel] fetch error:', sessionError, '— id:', params.id);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }

  if (!session || session.order_id) {
    return NextResponse.json(
      { error: 'Demande introuvable ou déjà traitée.' },
      { status: 404 },
    );
  }

  const { error: updateError } = await supabase
    .from('checkout_sessions')
    .update({
      status: 'cancelled',
      last_activity_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('payment_method', 'external_link')
    .in('status', ['open', 'expired', 'awaiting_verification'])
    .is('order_id', null);

  if (updateError) {
    console.error('[admin/checkout-sessions/cancel] update error:', updateError, '— id:', params.id);
    return NextResponse.json({ error: 'Impossible d\'annuler cette demande.' }, { status: 500 });
  }

  revalidatePath('/admin');
  revalidatePath('/admin/checkout-funnel');

  return NextResponse.json({ id: params.id, status: 'cancelled' as const });
}
