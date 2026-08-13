import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createRentalReservationFromRequest } from '@/lib/rental/createRentalReservationFromRequest';
import type { RentalReservationRequest } from '@lepefy/types';

// Confirmation manuelle d'un paiement via lien externe (PayPal/Revolut/autre
// — Phase 3, location matériel). Aucun webhook n'existe pour ces liens :
// c'est l'admin qui confirme depuis le bandeau "Paiements en attente"
// (/admin/evenementiel/reservations-materiel) après avoir vérifié la
// réception du paiement côté PayPal/Revolut.
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
    .from('rental_reservation_requests')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('status', 'pending')
    .maybeSingle() as { data: RentalReservationRequest | null; error: unknown };

  if (fetchError) {
    console.error('[admin/evenementiel/rental-reservation-requests/confirm-payment] fetch error:', fetchError, '— id:', params.id);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }

  if (!request) {
    return NextResponse.json({ error: 'Demande de paiement introuvable — a-t-elle déjà été traitée ?' }, { status: 404 });
  }

  const result = await createRentalReservationFromRequest(supabase, {
    serviceOfferingId: request.service_offering_id,
    tenantId:          request.tenant_id,
    items:             request.items,
    pickupDate:        request.pickup_date,
    customerName:      request.customer_name,
    customerEmail:     request.customer_email,
    customerPhone:     request.customer_phone ?? '',
    amountPaid:        request.amount,
  });

  if ('error' in result) {
    if (result.error === 'stock_conflict') {
      await supabase
        .from('rental_reservation_requests')
        .update({ status: 'stock_conflict' })
        .eq('id', request.id);

      return NextResponse.json({
        warning:
          'Stock insuffisant au moment de la confirmation. Aucun remboursement automatique n\'est possible pour ' +
          'ce moyen de paiement — contactez le client et remboursez-le manuellement via PayPal/Revolut.',
      });
    }

    console.error('[admin/evenementiel/rental-reservation-requests/confirm-payment] createRentalReservationFromRequest failed:',
      result.error, '— request:', request.id);
    return NextResponse.json({ error: 'Erreur lors de la création de la réservation.' }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from('rental_reservation_requests')
    .update({
      status:         'confirmed',
      confirmed_at:   new Date().toISOString(),
      reservation_id: result.reservationId,
    })
    .eq('id', request.id);

  if (updateError) {
    console.error('[admin/evenementiel/rental-reservation-requests/confirm-payment] request update error:', updateError,
      '— request:', request.id);
  }

  console.info('[admin/evenementiel/rental-reservation-requests/confirm-payment] Reservation created — id:', result.reservationId,
    '— request:', request.id);

  revalidatePath('/admin');
  revalidatePath('/admin/evenementiel/reservations-materiel');

  return NextResponse.json({ reservationId: result.reservationId });
}
