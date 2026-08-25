import type { SupabaseClient } from '@supabase/supabase-js';
import { generateTrackingToken } from '@/lib/tracking/generateTrackingToken';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { registerCheckoutConsent } from '@/lib/legal/registerCheckoutConsent';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import type { Order } from '@lepefy/types';

const stripe = getStripeClient('shop');

export interface CheckoutSessionRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  email: string;
  full_name: string | null;
  phone: string | null;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: Record<string, unknown> | null;
  shipping_details: Record<string, unknown> | null;
  shipping_total: number;
  ambassador_discount_amount: number | null;
  payment_method?: 'stripe' | 'external_link';
  external_payment_type?: string | null;
  external_payment_label?: string | null;
  consent_terms_accepted?: boolean | null;
  consent_terms_doc_version?: number | null;
  consent_marketing_accepted?: boolean | null;
  items: {
    productId: string | null;
    name: string;
    price: number;
    quantity: number;
    storage_type: 'dry' | 'fresh' | 'frozen' | null;
  }[];
}

export interface CreateOrderFromCheckoutSessionOpts {
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
  const items = session.items ?? [];
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const ambassadorDiscount = session.ambassador_discount_amount ?? 0;
  const total = subtotal + (session.shipping_total ?? 0) - ambassadorDiscount;

  console.info('[createOrderFromCheckoutSession] Creating order — tenant:', session.tenant_id,
    '— subtotal:', subtotal, '— total:', total, '— isStripe:', isStripe);

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({
      tenant_id: session.tenant_id,
      customer_id: session.customer_id ?? null,
      email: session.email,
      full_name: session.full_name ?? null,
      fulfillment_type: session.fulfillment_type,
      shipping_address: session.shipping_address ?? null,
      shipping_details: session.shipping_details ?? null,
      subtotal,
      shipping_cost: session.shipping_total ?? 0,
      total,
      ambassador_discount_amount: ambassadorDiscount,
      payment_method: isStripe ? 'stripe' : 'external_link',
      payment_status: 'paid',
      stripe_payment_intent_id: opts.stripePaymentIntentId ?? null,
      external_payment_type: isStripe ? null : session.external_payment_type ?? null,
      external_payment_label: isStripe ? null : session.external_payment_label ?? null,
      status: 'preparing',
      notes: session.phone ? `Téléphone: ${session.phone}` : null,
    })
    .select('*')
    .single();

  if (orderError || !order) {
    if ((orderError as { code?: string } | null)?.code === '23505') {
      console.info('[createOrderFromCheckoutSession] Order already created by concurrent retry — session:', session.id);
      return { error: 'already_exists' };
    }
    console.error('[createOrderFromCheckoutSession] Failed to create order:', orderError);
    return { error: 'order_insert_failed' };
  }

  console.info('[createOrderFromCheckoutSession] Order created — id:', order.id);

  try {
    await registerCheckoutConsent(supabase, {
      tenantId: session.tenant_id,
      orderId: order.id,
      customerId: session.customer_id ?? null,
      termsAccepted: session.consent_terms_accepted ?? null,
      termsDocVersion: session.consent_terms_doc_version ?? null,
      marketingAccepted: session.consent_marketing_accepted ?? null,
    });
  } catch (consentErr) {
    console.error('[createOrderFromCheckoutSession] registerCheckoutConsent failed:', consentErr,
      '— order_id:', order.id);
  }

  const stockByProduct = new Map<string, number>();
  for (const item of items) {
    if (!item.productId) continue;
    stockByProduct.set(item.productId, (stockByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  const stockDecrementItems = Array.from(stockByProduct.entries()).map(([productId, quantity]) => ({
    product_id: productId,
    quantity,
  }));

  const { error: stockError } = await supabase.rpc('decrement_stock_for_order', {
    items: stockDecrementItems,
  });

  if (stockError) {
    console.error('[createOrderFromCheckoutSession] Stock decrement failed AFTER payment capture — order:', order.id,
      '— reason:', stockError.message);
  } else {
    console.info('[createOrderFromCheckoutSession] Stock decremented — order:', order.id);
  }

  const orderItemsPayload = items.map((item) => ({
    order_id: order.id,
    tenant_id: session.tenant_id,
    product_id: item.productId ?? null,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    subtotal: item.price * item.quantity,
    storage_type: item.storage_type ?? 'dry',
  }));

  const { error: itemsError } = await (supabase as unknown as {
    from(table: 'order_items'): {
      insert(data: unknown[]): Promise<{ error: unknown }>;
    };
  }).from('order_items').insert(orderItemsPayload);

  if (itemsError) {
    console.error('[createOrderFromCheckoutSession] Failed to insert order_items:', itemsError, '— order_id:', order.id);
  } else {
    console.info('[createOrderFromCheckoutSession] order_items inserted —', orderItemsPayload.length, 'rows');
  }

  // A completed checkout is an analytics/audit record, not disposable data.
  const completedAt = new Date().toISOString();
  const { error: lifecycleError } = await supabase
    .from('checkout_sessions')
    .update({
      status: 'completed',
      order_id: order.id,
      completed_at: completedAt,
      last_activity_at: completedAt,
      updated_at: completedAt,
    })
    .eq('id', session.id)
    .eq('tenant_id', session.tenant_id);

  if (lifecycleError) {
    console.warn('[createOrderFromCheckoutSession] Failed to mark checkout completed:', lifecycleError,
      '— id:', session.id, '— order:', order.id);
  } else {
    console.info('[createOrderFromCheckoutSession] checkout_session completed — id:', session.id, '— order:', order.id);
  }

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
        status: 'stock_conflict',
        payment_status: isStripe ? (refundSucceeded ? 'refunded' : 'paid') : 'pending',
      })
      .eq('id', order.id);

    if (statusUpdateError) {
      console.error('[createOrderFromCheckoutSession] Failed to mark order as stock_conflict:', statusUpdateError,
        '— order:', order.id);
    }

    if (process.env.N8N_WEBHOOK_URL) {
      const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
      const adminOrderLink = `${storefrontUrl}/admin/orders/${order.id}`;

      await notifyN8n('/webhook/order-stock-conflict', {
        orderId: order.id,
        email: session.email,
        fullName: session.full_name ?? '',
        total,
        reason: stockError.message,
        refundSucceeded: isStripe ? refundSucceeded : null,
        manualRefundRequired: !isStripe,
        adminOrderLink,
      });
    } else {
      console.warn('[createOrderFromCheckoutSession] N8N_WEBHOOK_URL not set — skipping stock-conflict admin notification');
    }

    return { order: { ...order, status: 'stock_conflict' } as Order };
  }

  if (process.env.N8N_WEBHOOK_URL && process.env.TRACKING_SECRET) {
    const trackingToken = generateTrackingToken(order.id, session.email);
    const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
    const orderTrackingLink = `${storefrontUrl}/orders/${order.id}?token=${trackingToken}`;

    await notifyN8n('/webhook/order-confirmed', {
      orderId: order.id,
      orderNumber: `#${order.id.slice(0, 8).toUpperCase()}`,
      email: session.email,
      fullName: session.full_name ?? '',
      fulfillmentType: session.fulfillment_type,
      total,
      shippingTotal: session.shipping_total ?? 0,
      shippingAddress: session.shipping_address ?? null,
      orderTrackingLink,
    });
  } else {
    console.warn('[createOrderFromCheckoutSession] N8N_WEBHOOK_URL or TRACKING_SECRET not set — skipping n8n');
  }

  return { order: order as Order };
}
