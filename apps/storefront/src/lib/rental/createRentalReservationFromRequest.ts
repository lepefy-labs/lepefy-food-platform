import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { notifyN8n } from '@/lib/events/notifyN8n';
import type { RentalCheckoutItemInput } from '@lepefy/types';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Extrait de handleRentalReservationPaymentSucceeded (api/webhooks/stripe/route.ts)
// — même logique bit-à-bit pour le flux stripe, réutilisée telle quelle par
// api/admin/evenementiel/rental-reservation-requests/[id]/confirm-payment
// (Phase 3 — paiement via lien externe, confirmation manuelle). Seule
// différence entre les deux appelants : le remboursement automatique Stripe
// en cas de conflit de stock, impossible pour external_link (aucun
// PaymentIntent) — géré ci-dessous via `input.stripePaymentIntentId === undefined`.

export interface CreateRentalReservationInput {
  serviceOfferingId: string;
  tenantId:          string;
  items:             RentalCheckoutItemInput[];
  pickupDate:        string;
  customerName:      string;
  customerEmail:     string;
  customerPhone:     string;
  amountPaid:        number;
  /** intent.id — présent uniquement pour le flux Stripe. undefined pour external_link. */
  stripePaymentIntentId?: string;
}

export type CreateRentalReservationResult =
  | { reservationId: string }
  | { error: 'stock_conflict' | string };

export async function createRentalReservationFromRequest(
  supabase: SupabaseClient,
  input: CreateRentalReservationInput,
): Promise<CreateRentalReservationResult> {
  const isStripe = input.stripePaymentIntentId !== undefined;
  const { serviceOfferingId, tenantId, items, pickupDate, customerName, customerEmail, customerPhone, amountPaid } = input;

  if (items.length === 0) {
    console.error('[createRentalReservationFromRequest] No items to reserve — service:', serviceOfferingId);
    return { error: 'no_items' };
  }

  const { data: rentalItems } = await supabase
    .from('rental_items')
    .select('id, price_per_unit')
    .in('id', items.map((i) => i.rental_item_id));

  const priceByItem = new Map<string, number>(
    ((rentalItems ?? []) as { id: string; price_per_unit: number }[]).map((r) => [r.id, r.price_per_unit]),
  );

  // Décrément atomique de chaque article, un par un — rollback (restore) de
  // ce qui a déjà été décrémenté si un article échoue en cours de boucle.
  // Vérification atomique et définitive — jamais allentée pour external_link :
  // le risque de deux réservations sur le dernier article disponible existe
  // indépendamment du moyen de paiement.
  const reservedSoFar: { rental_item_id: string; quantity: number }[] = [];
  let stockConflict = false;

  for (const item of items) {
    const { data: result, error } = await supabase
      .rpc('reserve_rental_stock', { p_rental_item_id: item.rental_item_id, p_quantity: item.quantity })
      .single();

    const typedResult = result as { success: boolean; remaining: number } | null;

    if (error || !typedResult?.success) {
      stockConflict = true;
      console.error('[createRentalReservationFromRequest] Stock reservation failed — service:', serviceOfferingId,
        '— item:', item.rental_item_id, '— reason:', error ?? 'insufficient stock');
      break;
    }
    reservedSoFar.push(item);
  }

  if (stockConflict) {
    for (const item of reservedSoFar) {
      await supabase.rpc('restore_rental_stock', { p_rental_item_id: item.rental_item_id, p_quantity: item.quantity });
    }

    let refundSucceeded = false;
    if (isStripe && input.stripePaymentIntentId) {
      try {
        await stripe.refunds.create({ payment_intent: input.stripePaymentIntentId });
        refundSucceeded = true;
        console.info('[createRentalReservationFromRequest] Refund issued (stock conflict) — intent:', input.stripePaymentIntentId);
      } catch (refundErr) {
        console.error('[createRentalReservationFromRequest] Refund FAILED — intent:', input.stripePaymentIntentId,
          '— needs manual refund:', refundErr);
      }
    }

    await notifyN8n('/webhook/rental-reservation-stock-conflict', {
      serviceOfferingId, intentId: input.stripePaymentIntentId ?? null, customerName, customerEmail,
      refundSucceeded: isStripe ? refundSucceeded : null,
      manualRefundRequired: !isStripe,
    });

    return { error: 'stock_conflict' };
  }

  const { data: reservation, error: reservationError } = await supabase
    .from('rental_reservations')
    .insert({
      tenant_id:                 tenantId,
      service_offering_id:       serviceOfferingId,
      customer_name:             customerName,
      customer_email:            customerEmail,
      customer_phone:            customerPhone || null,
      pickup_date:               pickupDate,
      stripe_payment_intent_id:  input.stripePaymentIntentId ?? null,
      amount_paid:               amountPaid,
      status:                    'confirmed',
    })
    .select('id')
    .single();

  if (reservationError || !reservation) {
    if ((reservationError as { code?: string } | null)?.code === '23505') {
      console.info('[createRentalReservationFromRequest] Reservation already created by concurrent retry — service:', serviceOfferingId);
      return { error: 'already_exists' };
    }
    console.error('[createRentalReservationFromRequest] Failed to create reservation AFTER stock decrement — needs manual review:',
      reservationError, '— service:', serviceOfferingId);
    return { error: 'reservation_insert_failed' };
  }

  const itemsPayload = items.map((i) => ({
    reservation_id: reservation.id,
    rental_item_id: i.rental_item_id,
    quantity:       i.quantity,
    unit_price:     priceByItem.get(i.rental_item_id) ?? 0,
  }));

  const { error: itemsError } = await supabase.from('rental_reservation_items').insert(itemsPayload);
  if (itemsError) {
    console.error('[createRentalReservationFromRequest] Failed to insert reservation items:', itemsError, '— reservation:', reservation.id);
  }

  console.info('[createRentalReservationFromRequest] Reservation created — id:', reservation.id, '— service:', serviceOfferingId);

  const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
  await notifyN8n('/webhook/rental-reservation-confirmed', {
    reservationId: reservation.id, serviceOfferingId, customerName, customerEmail, customerPhone,
    pickupDate, amountPaid, items: itemsPayload,
    adminLink: `${storefrontUrl}/admin/evenementiel/reservations-materiel`,
  });

  return { reservationId: reservation.id };
}
