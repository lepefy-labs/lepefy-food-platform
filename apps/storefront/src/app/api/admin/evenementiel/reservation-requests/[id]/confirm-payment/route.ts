import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createEventReservationFromRequest } from '@/lib/events/createEventReservationFromRequest';
import type { EventReservationRequest } from '@lepefy/types';

// Confirmation manuelle d'un paiement via lien externe (PayPal/Revolut/autre
// — Phase 2, billetterie événementiel). Aucun webhook n'existe pour ces
// liens : c'est l'organisateur qui confirme depuis le bandeau "Paiements en
// attente" (EventDetailAdminClient.tsx) après avoir vérifié la réception du
// paiement côté PayPal/Revolut.
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data: request, error: fetchError } = await supabase
    .from('event_reservation_requests')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('status', 'pending')
    .maybeSingle() as { data: EventReservationRequest | null; error: unknown };

  if (fetchError) {
    console.error('[admin/evenementiel/reservation-requests/confirm-payment] fetch error:', fetchError, '— id:', params.id);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }

  if (!request) {
    return NextResponse.json({ error: 'Demande de paiement introuvable — a-t-elle déjà été traitée ?' }, { status: 404 });
  }

  const result = await createEventReservationFromRequest(supabase, {
    eventId:       request.event_id,
    tenantId:      request.tenant_id,
    items:         request.items,
    customerName:  request.customer_name,
    customerEmail: request.customer_email,
    customerPhone: request.customer_phone ?? '',
    amountPaid:    request.amount,
  });

  if ('error' in result) {
    if (result.error === 'stock_conflict') {
      await supabase
        .from('event_reservation_requests')
        .update({ status: 'stock_conflict' })
        .eq('id', request.id);

      return NextResponse.json({
        warning:
          'Capacité insuffisante au moment de la confirmation. Aucun remboursement automatique n\'est possible pour ' +
          'ce moyen de paiement — contactez le client et remboursez-le manuellement via PayPal/Revolut.',
      });
    }

    console.error('[admin/evenementiel/reservation-requests/confirm-payment] createEventReservationFromRequest failed:',
      result.error, '— request:', request.id);
    return NextResponse.json({ error: 'Erreur lors de la création de la réservation.' }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from('event_reservation_requests')
    .update({
      status:         'confirmed',
      confirmed_at:   new Date().toISOString(),
      reservation_id: result.reservationId,
    })
    .eq('id', request.id);

  if (updateError) {
    console.error('[admin/evenementiel/reservation-requests/confirm-payment] request update error:', updateError,
      '— request:', request.id);
  }

  console.info('[admin/evenementiel/reservation-requests/confirm-payment] Reservation created — id:', result.reservationId,
    '— request:', request.id);

  revalidatePath('/admin');
  revalidatePath(`/admin/evenementiel/evenements/${request.event_id}`);

  return NextResponse.json({ reservationId: result.reservationId });
}
