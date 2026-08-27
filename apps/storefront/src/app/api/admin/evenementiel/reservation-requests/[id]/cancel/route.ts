import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data: request, error: fetchError } = await supabase
    .from('event_reservation_requests')
    .select('id, event_id, status')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (fetchError) {
    console.error('[admin/evenementiel/reservation-requests/cancel] fetch error:', fetchError);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }
  if (!request) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });
  if (request.status !== 'pending') {
    return NextResponse.json({ error: 'Cette demande a déjà été traitée.' }, { status: 409 });
  }

  const { error: updateError } = await supabase
    .from('event_reservation_requests')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('status', 'pending');

  if (updateError) {
    console.error('[admin/evenementiel/reservation-requests/cancel] update error:', updateError);
    return NextResponse.json({ error: 'Impossible d’annuler cette demande.' }, { status: 500 });
  }

  revalidatePath('/admin/evenementiel/reservations');
  revalidatePath(`/admin/evenementiel/evenements/${request.event_id}`);
  revalidatePath(`/admin/evenementiel/paiements-en-attente/${params.id}`);

  return NextResponse.json({ ok: true });
}
