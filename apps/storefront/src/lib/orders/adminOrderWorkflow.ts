import { processOrderPointsOnDelivery } from '@/lib/loyalty/processOrderPointsOnDelivery';
import { generateTrackingToken } from '@/lib/tracking/generateTrackingToken';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { ensureReviewInviteForOrder } from '@/lib/reviews/reviewInvites';
import { emailRequest, type RenderedEmail } from '@/lib/notifications/sendEmail';
import {
  orderCancelledEmail, orderCompletedEmail, orderReadyForPickupEmail, orderShippedEmail,
} from '@/lib/notifications/customerEmails';
import type { OrderStatus } from '@lepefy/types';

export type FulfillmentType = 'delivery' | 'pickup';

type OrderTransitionSideEffectDependencies = {
  processOrderPointsOnDelivery: typeof processOrderPointsOnDelivery;
  notifyN8n: typeof notifyN8n;
  getTenantNotificationContext: typeof getTenantNotificationContext;
  ensureReviewInviteForOrder?: typeof ensureReviewInviteForOrder;
};

const VALID_STATUSES: OrderStatus[] = [
  'new',
  'preparing',
  'ready_for_pickup',
  'shipped',
  'delivered',
  'cancelled',
];

const DELIVERY_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  new: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
};

const PICKUP_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  new: ['preparing', 'cancelled'],
  preparing: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['delivered', 'cancelled'],
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value as OrderStatus);
}

export function getAllowedNextStatuses(
  current: OrderStatus,
  fulfillmentType: FulfillmentType,
): OrderStatus[] {
  const map = fulfillmentType === 'pickup' ? PICKUP_TRANSITIONS : DELIVERY_TRANSITIONS;
  return map[current] ?? [];
}

export function getPrimaryNextStatus(
  current: OrderStatus,
  fulfillmentType: FulfillmentType,
): OrderStatus | null {
  if (current === 'new') return 'preparing';
  if (current === 'preparing') {
    return fulfillmentType === 'pickup' ? 'ready_for_pickup' : 'shipped';
  }
  if (current === 'ready_for_pickup' && fulfillmentType === 'pickup') return 'delivered';
  if (current === 'shipped' && fulfillmentType === 'delivery') return 'delivered';
  return null;
}

export function validateOrderTransition({
  current,
  next,
  fulfillmentType,
  trackingCode,
}: {
  current: OrderStatus;
  next: OrderStatus;
  fulfillmentType: FulfillmentType;
  trackingCode?: string | null;
}): { ok: true } | { ok: false; error: string } {
  if (current === next) return { ok: true };
  const allowed = getAllowedNextStatuses(current, fulfillmentType);
  if (!allowed.includes(next)) return { ok: false, error: `Transition de statut non autorisée : ${current} → ${next}.` };
  if (next === 'shipped') {
    if (fulfillmentType !== 'delivery') return { ok: false, error: 'Une commande Click & Collect ne peut pas être expédiée.' };
    if (!trackingCode?.trim()) return { ok: false, error: 'Le code de suivi est requis avant expédition.' };
  }
  if (next === 'ready_for_pickup' && fulfillmentType !== 'pickup') return { ok: false, error: 'Ce statut est réservé au Click & Collect.' };
  return { ok: true };
}

function buildTrackingLink(orderId: string, email: string | null, storefrontUrl: string): string | null {
  if (!process.env.TRACKING_SECRET || !storefrontUrl) return null;
  const trackingToken = generateTrackingToken(orderId, email);
  return `${storefrontUrl}/orders/${orderId}?token=${trackingToken}`;
}

export async function runOrderTransitionSideEffects({
  tenantId,
  orderId,
  previousStatus,
  nextStatus,
  email,
  fullName,
  fulfillmentType,
  trackingCode,
  trackingCarrier,
  shippingEstimatedDeliveryAt,
}: {
  tenantId: string;
  orderId: string;
  previousStatus: OrderStatus;
  nextStatus: OrderStatus;
  // Null pour une commande assistée sans e-mail : aucun e-mail client n'est
  // émis (loyalty et avis restent traités) ; le lien de suivi se partage
  // manuellement depuis l'admin.
  email: string | null;
  fullName: string | null;
  fulfillmentType: FulfillmentType;
  trackingCode?: string | null;
  trackingCarrier?: string | null;
  shippingEstimatedDeliveryAt?: string | null;
}, dependencies: OrderTransitionSideEffectDependencies = { processOrderPointsOnDelivery, notifyN8n, getTenantNotificationContext, ensureReviewInviteForOrder }) {
  if (nextStatus === previousStatus) return;

  if (nextStatus === 'delivered') {
    try {
      await dependencies.processOrderPointsOnDelivery(orderId);
    } catch (error) {
      console.error('[admin order workflow] loyalty processing failed:', error, '— order_id:', orderId);
    }
    try {
      await dependencies.ensureReviewInviteForOrder?.(tenantId, orderId);
    } catch (error) {
      console.error('[admin order workflow] review invite scheduling failed:', error, '— order_id:', orderId);
    }
  }

  if (!process.env.N8N_WEBHOOK_URL) return;
  if (!email) {
    console.info('[admin order workflow] order without email — customer notification skipped — order_id:', orderId);
    return;
  }
  const tenant = await dependencies.getTenantNotificationContext(tenantId);
  if (!tenant) {
    console.warn('[admin order workflow] tenant notification context unavailable — skipping webhook — tenant_id:', tenantId);
    return;
  }

  // Rendered in-app and delivered through send-email (phase 2); one email per
  // order and status thanks to the idempotency key.
  const order = {
    orderNumber: `#${orderId.slice(0, 8).toUpperCase()}`,
    fullName: fullName ?? '',
    orderTrackingLink: buildTrackingLink(orderId, email, tenant.storefrontUrl),
  };
  const send = (notificationType: string, key: string, rendered: RenderedEmail) =>
    dependencies.notifyN8n(...emailRequest(tenant, {
      ...rendered, notificationType, idempotencyKey: `${key}:${orderId}`, recipients: [email],
    }));

  if (nextStatus === 'shipped') {
    await send('order_shipped', 'order-shipped',
      orderShippedEmail(tenant, {
        ...order, trackingCode: trackingCode ?? null, trackingCarrier: trackingCarrier ?? null,
        shippingEstimatedDeliveryAt: shippingEstimatedDeliveryAt ?? null,
      }));
    return;
  }
  if (nextStatus === 'ready_for_pickup') {
    await send('order_ready_for_pickup', 'order-ready-for-pickup', orderReadyForPickupEmail(tenant, order));
    return;
  }
  if (nextStatus === 'delivered') {
    await send('order_completed', 'order-completed',
      orderCompletedEmail(tenant, { ...order, completionType: fulfillmentType === 'pickup' ? 'picked_up' : 'delivered' }));
    return;
  }
  if (nextStatus === 'cancelled') await send('order_cancelled', 'order-cancelled', orderCancelledEmail(tenant, order));
}
