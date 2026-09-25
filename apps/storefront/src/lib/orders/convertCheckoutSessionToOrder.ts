import type { SupabaseClient } from '@supabase/supabase-js';
import type { Order, SalesChannel } from '@lepefy/types';
import { generateTrackingToken } from '@/lib/tracking/generateTrackingToken';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { registerCheckoutConsent } from '@/lib/legal/registerCheckoutConsent';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { recordNalaPurchaseAttribution } from '@/lib/ai/nalaConversionAttribution';
import { recordOrderCustomerEvents } from '@/lib/customers/recordCustomerEvents';
import { recordAssistedOrderEvent } from '@/lib/orders/assisted/assistedOrderEvents';

/**
 * Service central de conversion « checkout_session payée → commande ».
 *
 * Utilisé par : webhook Stripe des précommandes assistées, confirmation admin
 * d'un paiement externe (storefront et assisté), enregistrement « Déjà payé ».
 *
 * L'écriture est entièrement déléguée à la RPC transactionnelle
 * `convert_checkout_session_to_order` (migration 128) : verrou de la session,
 * commande + lignes + stock + clôture dans une seule transaction, clé unique
 * `orders.checkout_session_id`. Seul l'appel qui crée réellement la commande
 * (`created = true`) déclenche les effets de bord (consentement, CRM, Nala,
 * notifications, remboursement en cas de conflit de stock) : un webhook
 * rejoué ou deux confirmations simultanées ne produisent ni second ordre, ni
 * second décrément, ni seconde notification.
 */

export type ConversionPayment =
  | { source: 'stripe_webhook'; paymentIntentId: string }
  | {
      source: 'admin_verified' | 'admin_recorded';
      method: 'external_link' | 'manual';
      externalPaymentType?: string | null;
      externalPaymentLabel?: string | null;
      receivedAt?: string | null;
      reference?: string | null;
      confirmedBy?: string | null;
      note?: string | null;
    };

export type CustomerNotificationOutcome =
  | 'sent' | 'failed' | 'skipped_no_email' | 'skipped_by_choice' | 'skipped_unconfigured' | 'not_applicable';

export type ConversionFailureReason =
  | 'session_not_found' | 'session_not_convertible' | 'session_items_empty' | 'rpc_unavailable' | 'conversion_failed';

export type ConvertCheckoutSessionResult =
  | {
      ok: true;
      order: Order;
      created: boolean;
      stockConflict: boolean;
      refundSucceeded: boolean | null;
      customerNotification: CustomerNotificationOutcome;
      trackingLink: string | null;
    }
  | { ok: false; reason: ConversionFailureReason; sessionStatus?: string };

interface ConvertedSessionRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: Record<string, unknown> | null;
  shipping_total: number | null;
  origin?: 'storefront' | 'assisted';
  sales_channel?: SalesChannel | null;
  notify_customer?: boolean | null;
  consent_terms_accepted?: boolean | null;
  consent_terms_doc_version?: number | null;
  consent_marketing_accepted?: boolean | null;
  items: Array<{ productId: string | null; name: string; price: number; quantity: number }>;
}

interface RpcResult {
  order_id: string;
  created: boolean;
  stock_conflict: boolean;
  stock_error?: string | null;
}

function mapRpcError(error: { code?: string; message?: string }): { reason: ConversionFailureReason; sessionStatus?: string } {
  const message = error.message ?? '';
  if (error.code === 'PGRST202' || error.code === '42883') return { reason: 'rpc_unavailable' };
  if (message.includes('session_not_found')) return { reason: 'session_not_found' };
  if (message.includes('session_items_empty')) return { reason: 'session_items_empty' };
  const notConvertible = /session_not_convertible:(\w+)/.exec(message);
  if (notConvertible) return { reason: 'session_not_convertible', sessionStatus: notConvertible[1] };
  return { reason: 'conversion_failed' };
}

export function orderNumberFor(orderId: string): string {
  return `#${orderId.slice(0, 8).toUpperCase()}`;
}

export function buildOrderTrackingLink(orderId: string, email: string | null, storefrontUrl: string | null | undefined): string | null {
  if (!process.env.TRACKING_SECRET || !storefrontUrl) return null;
  return `${storefrontUrl.replace(/\/$/, '')}/orders/${orderId}?token=${generateTrackingToken(orderId, email)}`;
}

function rpcPayload(payment: ConversionPayment): Record<string, unknown> {
  if (payment.source === 'stripe_webhook') {
    return { source: 'stripe_webhook', payment_method: 'stripe', stripe_payment_intent_id: payment.paymentIntentId };
  }
  return {
    source: payment.source,
    payment_method: payment.method,
    external_payment_type: payment.externalPaymentType ?? null,
    external_payment_label: payment.externalPaymentLabel ?? null,
    received_at: payment.receivedAt ?? null,
    reference: payment.reference ?? null,
    confirmed_by: payment.confirmedBy ?? null,
    note: payment.note ?? null,
  };
}

export interface ConversionSideEffectDependencies {
  notifyN8n: typeof notifyN8n;
  getTenantNotificationContext: typeof getTenantNotificationContext;
  registerCheckoutConsent: typeof registerCheckoutConsent;
  recordOrderCustomerEvents: typeof recordOrderCustomerEvents;
  recordNalaPurchaseAttribution: typeof recordNalaPurchaseAttribution;
  refundPaymentIntent: (paymentIntentId: string) => Promise<{ id: string }>;
}

const defaultDependencies: ConversionSideEffectDependencies = {
  notifyN8n,
  getTenantNotificationContext,
  registerCheckoutConsent,
  recordOrderCustomerEvents,
  recordNalaPurchaseAttribution,
  refundPaymentIntent: (paymentIntentId) => getStripeClient('shop').refunds.create({ payment_intent: paymentIntentId }),
};

export async function convertCheckoutSessionToOrder(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    sessionId: string;
    payment: ConversionPayment;
    /** Surcharge explicite ; par défaut `notify_customer` (assisté) ou true (storefront). */
    notifyCustomer?: boolean;
  },
  deps: ConversionSideEffectDependencies = defaultDependencies,
): Promise<ConvertCheckoutSessionResult> {
  const { data: rpcData, error: rpcError } = await supabase.rpc('convert_checkout_session_to_order', {
    p_tenant_id: input.tenantId,
    p_session_id: input.sessionId,
    p_payment: rpcPayload(input.payment),
  });

  if (rpcError || !rpcData) {
    const mapped = mapRpcError((rpcError ?? {}) as { code?: string; message?: string });
    const log = mapped.reason === 'conversion_failed' || mapped.reason === 'rpc_unavailable' ? console.error : console.info;
    log('[convertCheckoutSessionToOrder] conversion refused —', mapped.reason, '— session:', input.sessionId,
      '— detail:', rpcError?.message);
    return { ok: false, ...mapped };
  }

  const result = rpcData as RpcResult;
  const [{ data: orderRow, error: orderError }, { data: sessionRow }] = await Promise.all([
    supabase.from('orders').select('*').eq('id', result.order_id).eq('tenant_id', input.tenantId).single(),
    supabase.from('checkout_sessions').select('*').eq('id', input.sessionId).eq('tenant_id', input.tenantId).maybeSingle(),
  ]);
  if (orderError || !orderRow) {
    console.error('[convertCheckoutSessionToOrder] order reload failed — order:', result.order_id, orderError);
    return { ok: false, reason: 'conversion_failed' };
  }

  let order = orderRow as Order;
  const session = sessionRow as ConvertedSessionRow | null;
  const isAssisted = session?.origin === 'assisted';
  const isStripe = input.payment.source === 'stripe_webhook';
  const tenantContext = await deps.getTenantNotificationContext(input.tenantId).catch(() => null);
  const storefrontUrl = tenantContext?.storefrontUrl ?? process.env.NEXT_PUBLIC_STOREFRONT_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  const trackingLink = buildOrderTrackingLink(order.id, order.email, storefrontUrl);

  if (!result.created) {
    console.info('[convertCheckoutSessionToOrder] session already converted — no side effects — session:',
      input.sessionId, '— order:', order.id);
    return {
      ok: true, order, created: false, stockConflict: result.stock_conflict, refundSucceeded: null,
      customerNotification: 'not_applicable', trackingLink,
    };
  }

  console.info('[convertCheckoutSessionToOrder] order created — id:', order.id, '— session:', input.sessionId,
    '— source:', input.payment.source, '— stock_conflict:', result.stock_conflict);

  const assistedEvent = (eventType: Parameters<typeof recordAssistedOrderEvent>[1]['eventType'], detail: Record<string, unknown> = {}) =>
    isAssisted
      ? recordAssistedOrderEvent(supabase, {
          tenantId: input.tenantId, checkoutSessionId: input.sessionId, orderId: order.id, eventType,
          actorType: input.payment.source === 'stripe_webhook' ? 'system' : 'admin',
          actorAdminId: input.payment.source === 'stripe_webhook' ? null : input.payment.confirmedBy ?? null,
          detail,
        })
      : Promise.resolve();

  if (session) {
    try {
      await deps.registerCheckoutConsent(supabase, {
        tenantId: input.tenantId,
        orderId: order.id,
        customerId: session.customer_id ?? null,
        termsAccepted: session.consent_terms_accepted ?? null,
        termsDocVersion: session.consent_terms_doc_version ?? null,
        marketingAccepted: session.consent_marketing_accepted ?? null,
      });
    } catch (consentErr) {
      console.error('[convertCheckoutSessionToOrder] registerCheckoutConsent failed:', consentErr, '— order_id:', order.id);
    }
  }

  const payment = input.payment;
  await assistedEvent('payment_confirmed', payment.source === 'stripe_webhook'
    ? { source: payment.source, method: 'stripe' }
    : { source: payment.source, method: payment.method, external_payment_type: payment.externalPaymentType ?? null });
  await assistedEvent('order_created', { order_number: orderNumberFor(order.id), total: order.total });

  if (result.stock_conflict) {
    let refundSucceeded: boolean | null = null;
    if (input.payment.source === 'stripe_webhook') {
      refundSucceeded = false;
      try {
        const refund = await deps.refundPaymentIntent(input.payment.paymentIntentId);
        refundSucceeded = true;
        console.info('[convertCheckoutSessionToOrder] Refund issued — order:', order.id, '— refund id:', refund.id);
      } catch (refundErr) {
        console.error('[convertCheckoutSessionToOrder] Refund FAILED — order:', order.id, '— needs manual refund:', refundErr);
      }
      if (refundSucceeded) {
        const { data: refunded } = await supabase.from('orders').update({ payment_status: 'refunded' })
          .eq('id', order.id).eq('tenant_id', input.tenantId).select('*').maybeSingle();
        if (refunded) order = refunded as Order;
      }
    }
    await assistedEvent('stock_conflict', { reason: result.stock_error ?? null, refund_succeeded: refundSucceeded });

    await deps.notifyN8n('/webhook/order-stock-conflict', {
      ...(tenantContext ?? { tenantId: input.tenantId }),
      orderId: order.id,
      orderNumber: orderNumberFor(order.id),
      email: order.email,
      fullName: order.full_name ?? '',
      fulfillmentType: order.fulfillment_type,
      total: order.total,
      reason: result.stock_error ?? null,
      refundSucceeded,
      manualRefundRequired: !isStripe,
      adminOrderLink: `${storefrontUrl}/admin/orders/${order.id}`,
    });

    return {
      ok: true, order, created: true, stockConflict: true, refundSucceeded,
      customerNotification: 'not_applicable', trackingLink,
    };
  }

  const items = session?.items ?? [];
  await deps.recordOrderCustomerEvents({
    tenantId: input.tenantId,
    customerId: order.customer_id,
    orderId: order.id,
    total: order.total,
    source: isAssisted ? 'assisted_order' : isStripe ? 'stripe_webhook' : 'external_payment_confirmation',
    items: items.map((item) => ({
      productId: item.productId, name: item.name, quantity: item.quantity, subtotal: item.price * item.quantity,
    })),
    orderMetadata: isAssisted
      ? { order_origin: 'assisted', sales_channel: session?.sales_channel ?? null, payment_confirmation_source: input.payment.source }
      : undefined,
  });
  // Nala n'est jamais crédité d'une vente saisie par l'équipe.
  if (!isAssisted) {
    await deps.recordNalaPurchaseAttribution({ supabase, checkoutSessionId: input.sessionId, orderId: order.id });
  }

  const wantsNotification = input.notifyCustomer ?? (isAssisted ? session?.notify_customer !== false : true);
  let customerNotification: CustomerNotificationOutcome;
  if (!wantsNotification) {
    customerNotification = 'skipped_by_choice';
  } else if (!order.email) {
    customerNotification = 'skipped_no_email';
  } else if (!process.env.N8N_WEBHOOK_URL || !trackingLink) {
    console.warn('[convertCheckoutSessionToOrder] N8N_WEBHOOK_URL or TRACKING_SECRET not set — skipping n8n');
    customerNotification = 'skipped_unconfigured';
  } else {
    const accepted = await deps.notifyN8n('/webhook/order-confirmed', {
      ...(tenantContext ?? { tenantId: input.tenantId }),
      orderId: order.id,
      orderNumber: orderNumberFor(order.id),
      email: order.email,
      fullName: order.full_name ?? '',
      fulfillmentType: order.fulfillment_type,
      total: order.total,
      shippingTotal: order.shipping_cost ?? 0,
      shippingAddress: order.shipping_address ?? null,
      orderTrackingLink: trackingLink,
    });
    customerNotification = accepted ? 'sent' : 'failed';
  }
  await assistedEvent(customerNotification === 'sent' ? 'notification_sent' : 'notification_skipped', {
    channel: 'email', template: 'order-confirmed', outcome: customerNotification,
  });

  return {
    ok: true, order, created: true, stockConflict: false, refundSucceeded: null, customerNotification, trackingLink,
  };
}
