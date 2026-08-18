import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';

// Endpoint unique pour les deux types de réservation (événement BBQ ou
// location matériel) — l'id est cherché successivement dans les deux
// tables, comme décrit dans le brief ("évènement ou rental"). Rembourse le
// PaymentIntent, marque la réservation refunded, et restaure la
// capacité/le stock consommés au moment de la confirmation.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  // ── Réservation événement ────────────────────────────────────────────────
  const { data: eventReservation } = await supabase
    .from('event_reservations')
    .select('id, tenant_id, event_id, stripe_payment_intent_id, quantity_total, status')
    .eq('id', params.id)
    .maybeSingle();

  if (eventReservation) {
    if (eventReservation.tenant_id !== tenant.id) {
      return NextResponse.json({ error: 'Réservation introuvable.' }, { status: 404 });
    }
    if (eventReservation.status === 'refunded') {
      return NextResponse.json({ error: 'Déjà remboursée.' }, { status: 409 });
    }

    try {
      await getStripeClient('event').refunds.create({ payment_intent: eventReservation.stripe_payment_intent_id });
    } catch (err) {
      console.error('[evenementiel/refund] Stripe refund failed — reservation:', eventReservation.id, err);
      return NextResponse.json({ error: 'Échec du remboursement Stripe.' }, { status: 500 });
    }

    await supabase
      .from('event_reservations')
      .update({ status: 'refunded' })
      .eq('id', eventReservation.id);

    await supabase.rpc('restore_event_capacity', {
      p_event_id: eventReservation.event_id,
      p_quantity: eventReservation.quantity_total,
    });

    return NextResponse.json({ success: true, type: 'event' });
  }

  // ── Réservation location matériel ────────────────────────────────────────
  const { data: rentalReservation } = await supabase
    .from('rental_reservations')
    .select('id, tenant_id, stripe_payment_intent_id, status')
    .eq('id', params.id)
    .maybeSingle();

  if (rentalReservation) {
    if (rentalReservation.tenant_id !== tenant.id) {
      return NextResponse.json({ error: 'Réservation introuvable.' }, { status: 404 });
    }
    if (rentalReservation.status === 'refunded') {
      return NextResponse.json({ error: 'Déjà remboursée.' }, { status: 409 });
    }

    try {
      await getStripeClient('rental').refunds.create({ payment_intent: rentalReservation.stripe_payment_intent_id });
    } catch (err) {
      console.error('[evenementiel/refund] Stripe refund failed — reservation:', rentalReservation.id, err);
      return NextResponse.json({ error: 'Échec du remboursement Stripe.' }, { status: 500 });
    }

    await supabase
      .from('rental_reservations')
      .update({ status: 'refunded' })
      .eq('id', rentalReservation.id);

    const { data: items } = await supabase
      .from('rental_reservation_items')
      .select('rental_item_id, quantity')
      .eq('reservation_id', rentalReservation.id);

    for (const item of (items ?? []) as { rental_item_id: string; quantity: number }[]) {
      await supabase.rpc('restore_rental_stock', {
        p_rental_item_id: item.rental_item_id,
        p_quantity:       item.quantity,
      });
    }

    return NextResponse.json({ success: true, type: 'rental' });
  }

  return NextResponse.json({ error: 'Réservation introuvable.' }, { status: 404 });
}
