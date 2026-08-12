import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { generateTrackingToken } from '@/lib/tracking/generateTrackingToken';
import { notifyN8n } from '@/lib/events/notifyN8n';
import type { Order } from '@lepefy/types';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// Extrait de api/webhooks/stripe/route.ts (payment_intent.succeeded) —
// même logique bit-à-bit pour le flux stripe, réutilisée telle quelle par
// api/admin/checkout-sessions/[id]/confirm-payment (Phase 1 — paiement via
// lien externe, confirmation manuelle). La seule branche qui diffère entre
// les deux appelants est le remboursement automatique Stripe en cas de
// conflit de stock : impossible pour external_link (aucun PaymentIntent),
// géré ci-dessous via `opts.stripePaymentIntentId === undefined`.

export interface CheckoutSessionRow {
  id:               string;
  tenant_id:        string;
  customer_id:      string | null;
  email:            string;
  full_name:        string | null;
  phone:            string | null;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: Record<string, unknown> | null;
  shipping_details: Record<string, unknown> | null;
  shipping_total:   number;
  ambassador_discount_amount: number | null;
  payment_method?:  'stripe' | 'external_link';
  external_payment_type?:  string | null;
  external_payment_label?: string | null;
  items: {
    productId:    string | null;
    name:         string;
    price:        number;
    quantity:     number;
    storage_type: 'dry' | 'fresh' | 'frozen' | null;
  }[];
}

export interface CreateOrderFromCheckoutSessionOpts {
  /** intent.id — présent uniquement pour le flux Stripe (payment_intent.succeeded). */
  stripePaymentIntentId?: string;
}

export type CreateOrderFromCheckoutSessionResult =
  | { order: Order }
  | { error: string };

export async function createOrderFromCheckoutSession(
  supabase: SupabaseClient,
  session: CheckoutSessionRow,
  opts: CreateOrderFromCheckoutSessionOpts = {},
): Promise<CreateOrderFromCheckoutSessionResult> {
  const isStripe = opts.stripePaymentIntentId !== undefined;

  // ── Compute totals ───────────────────────────────────────────────────────
  // ambassador_discount_amount vient de checkout_sessions, PAS recalculé ici :
  // c'est la valeur déjà figée au moment de la requête de paiement — le
  // client a payé (ou va payer) exactement ce montant.
  const items              = session.items ?? [];
  const subtotal           = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const ambassadorDiscount = session.ambassador_discount_amount ?? 0;
  const total               = subtotal + (session.shipping_total ?? 0) - ambassadorDiscount;

  console.info('[createOrderFromCheckoutSession] Creating order — tenant:', session.tenant_id,
    '— subtotal:', subtotal, '— total:', total, '— isStripe:', isStripe);

  // ── Create order ─────────────────────────────────────────────────────────
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      tenant_id:                 session.tenant_id,
      customer_id:               session.customer_id ?? null,
      email:                     session.email,
      full_name:                 session.full_name ?? null,
      fulfillment_type:          session.fulfillment_type,
      shipping_address:          session.shipping_address ?? null,
      shipping_details:          session.shipping_details ?? null,
      subtotal,
      shipping_cost:             session.shipping_total ?? 0,
      total,
      ambassador_discount_amount: ambassadorDiscount,
      payment_method:            isStripe ? 'stripe' : 'external_link',
      // 'paid' dans les deux cas : cette fonction n'est appelée qu'après
      // confirmation du paiement — payment_intent.succeeded pour Stripe, clic
      // "Confirmer réception" côté admin pour external_link (l'équivalent
      // manuel de payment_intent.succeeded, voir Fix 1). Le ramo stock_conflict
      // plus bas peut ensuite repasser ce statut à 'pending' (external_link)
      // ou 'refunded' (Stripe, remboursement automatique) — logique inchangée.
      payment_status:            'paid',
      stripe_payment_intent_id:  opts.stripePaymentIntentId ?? null,
      external_payment_type:     isStripe ? null : session.external_payment_type ?? null,
      external_payment_label:    isStripe ? null : session.external_payment_label ?? null,
      status:                    'preparing',
      notes:                     session.phone ? `Téléphone: ${session.phone}` : null,
    })
    .select('*')
    .single();

  if (orderError || !order) {
    // 23505 = unique_violation su stripe_payment_intent_id: un retry
    // concorrente ha già creato l'ordine — non è un errore.
    if ((orderError as { code?: string } | null)?.code === '23505') {
      console.info('[createOrderFromCheckoutSession] Order already created by concurrent retry — session:', session.id);
      return { error: 'already_exists' };
    }
    console.error('[createOrderFromCheckoutSession] Failed to create order:', orderError);
    return { error: 'order_insert_failed' };
  }

  console.info('[createOrderFromCheckoutSession] Order created — id:', order.id);

  // ── Décrément atomique du stock (confirmation définitive du paiement) ────
  const stockByProduct = new Map<string, number>();
  for (const i of items) {
    if (!i.productId) continue;
    stockByProduct.set(i.productId, (stockByProduct.get(i.productId) ?? 0) + i.quantity);
  }
  const stockDecrementItems = Array.from(stockByProduct.entries()).map(
    ([productId, quantity]) => ({ product_id: productId, quantity }),
  );

  const { error: stockError } = await supabase.rpc('decrement_stock_for_order', {
    items: stockDecrementItems,
  });

  if (stockError) {
    console.error('[createOrderFromCheckoutSession] Stock decrement failed AFTER payment capture — order:', order.id,
      '— reason:', stockError.message);
  } else {
    console.info('[createOrderFromCheckoutSession] Stock decremented — order:', order.id);
  }

  // ── Insert order_items ───────────────────────────────────────────────────
  const orderItemsPayload = items.map((i) => ({
    order_id:     order.id,
    tenant_id:    session.tenant_id,
    product_id:   i.productId ?? null,
    name:         i.name,
    price:        i.price,
    quantity:     i.quantity,
    subtotal:     i.price * i.quantity,
    storage_type: i.storage_type ?? 'dry',
  }));

  const { error: itemsError } = await (supabase as unknown as {
    from(table: 'order_items'): {
      insert(data: unknown[]): Promise<{ error: unknown }>;
    };
  }).from('order_items').insert(orderItemsPayload);

  if (itemsError) {
    console.error('[createOrderFromCheckoutSession] Failed to insert order_items:', itemsError,
      '— order_id:', order.id);
  } else {
    console.info('[createOrderFromCheckoutSession] order_items inserted —', orderItemsPayload.length, 'rows');
  }

  // ── Delete checkout_session ──────────────────────────────────────────────
  const { error: deleteError } = await supabase
    .from('checkout_sessions')
    .delete()
    .eq('id', session.id);

  if (deleteError) {
    console.warn('[createOrderFromCheckoutSession] Failed to delete checkout_session:', deleteError,
      '— id:', session.id);
  } else {
    console.info('[createOrderFromCheckoutSession] checkout_session deleted — id:', session.id);
  }

  // ── Cas conflit de stock post-paiement ────────────────────────────────────
  // Stripe : le client a déjà payé — remboursement automatique + alerte
  // admin. external_link : aucun PaymentIntent, aucun remboursement
  // automatique possible — l'admin doit gérer le remboursement manuellement
  // côté PayPal/Revolut (signalé côté UI par Task 4/api route caller).
  if (stockError) {
    let refundSucceeded = false;

    if (isStripe && opts.stripePaymentIntentId) {
      try {
        const refund = await stripe.refunds.create({ payment_intent: opts.stripePaymentIntentId });
        refundSucceeded = true;
        console.info('[createOrderFromCheckoutSession] Refund issued — order:', order.id, '— refund id:', refund.id);
      } catch (refundErr) {
        console.error('[createOrderFromCheckoutSession] Refund FAILED — order:', order.id, '— needs manual refund:', refundErr);
      }
    }

    const { error: statusUpdateError } = await supabase
      .from('orders')
      .update({
        status:         'stock_conflict',
        payment_status: isStripe ? (refundSucceeded ? 'refunded' : 'paid') : 'pending',
      })
      .eq('id', order.id);

    if (statusUpdateError) {
      console.error('[createOrderFromCheckoutSession] Failed to mark order as stock_conflict:', statusUpdateError,
        '— order:', order.id);
    }

    if (process.env.N8N_WEBHOOK_URL) {
      const storefrontUrl  = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
      const adminOrderLink = `${storefrontUrl}/admin/orders/${order.id}`;

      await notifyN8n('/webhook/order-stock-conflict', {
        orderId:         order.id,
        email:           session.email,
        fullName:        session.full_name ?? '',
        total,
        reason:          stockError.message, // "insufficient_stock:<product_id>"
        refundSucceeded: isStripe ? refundSucceeded : null,
        manualRefundRequired: !isStripe,
        adminOrderLink,
      });
    } else {
      console.warn('[createOrderFromCheckoutSession] N8N_WEBHOOK_URL not set — skipping stock-conflict admin notification');
    }

    return { order: { ...order, status: 'stock_conflict' } as Order };
  }

  // ── Notify n8n ───────────────────────────────────────────────────────────
  if (process.env.N8N_WEBHOOK_URL && process.env.TRACKING_SECRET) {
    const trackingToken     = generateTrackingToken(order.id, session.email);
    const storefrontUrl     = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
    const orderTrackingLink = `${storefrontUrl}/orders/${order.id}?token=${trackingToken}`;

    await notifyN8n('/webhook/order-confirmed', {
      orderId:          order.id,
      email:            session.email,
      fullName:         session.full_name ?? '',
      total,
      shippingTotal:    session.shipping_total ?? 0,
      shippingAddress:  session.shipping_address ?? null,
      orderTrackingLink,
    });
  } else {
    console.warn('[createOrderFromCheckoutSession] N8N_WEBHOOK_URL or TRACKING_SECRET not set — skipping n8n');
  }

  return { order: order as Order };
}
