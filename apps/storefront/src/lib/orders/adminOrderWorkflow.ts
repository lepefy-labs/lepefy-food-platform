import { processOrderPointsOnDelivery } from '@/lib/loyalty/processOrderPointsOnDelivery';
import { generateTrackingToken } from '@/lib/tracking/generateTrackingToken';
import type { OrderStatus } from '@lepefy/types';

export type FulfillmentType = 'delivery' | 'pickup';

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
  if (!allowed.includes(next)) {
    return {
      ok: false,
      error: `Transition de statut non autorisée : ${current} → ${next}.`,
    };
  }

  if (next === 'shipped') {
    if (fulfillmentType !== 'delivery') {
      return { ok: false, error: 'Une commande Click & Collect ne peut pas être expédiée.' };
    }
    if (!trackingCode?.trim()) {
      return { ok: false, error: 'Le code de suivi est requis avant expédition.' };
    }
  }

  if (next === 'ready_for_pickup' && fulfillmentType !== 'pickup') {
    return { ok: false, error: 'Ce statut est réservé au Click & Collect.' };
  }

  return { ok: true };
}

export async function runOrderTransitionSideEffects({
  orderId,
  previousStatus,
  nextStatus,
  email,
  fullName,
  trackingCode,
  trackingCarrier,
}: {
  orderId: string;
  previousStatus: OrderStatus;
  nextStatus: OrderStatus;
  email: string;
  fullName: string | null;
  trackingCode?: string | null;
  trackingCarrier?: string | null;
}) {
  if (nextStatus === previousStatus) return;

  if (nextStatus === 'delivered') {
    try {
      await processOrderPointsOnDelivery(orderId);
    } catch (error) {
      console.error('[admin order workflow] loyalty processing failed:', error, '— order_id:', orderId);
    }
  }

  if (
    nextStatus === 'shipped' &&
    process.env.N8N_WEBHOOK_URL &&
    process.env.TRACKING_SECRET
  ) {
    try {
      const trackingToken = generateTrackingToken(orderId, email);
      const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? '';
      const orderTrackingLink = `${storefrontUrl}/orders/${orderId}?token=${trackingToken}`;

      const response = await fetch(`${process.env.N8N_WEBHOOK_URL}/webhook/order-shipped`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          orderNumber: `#${orderId.slice(0, 8).toUpperCase()}`,
          email,
          fullName: fullName ?? '',
          trackingCode: trackingCode ?? null,
          trackingCarrier: trackingCarrier ?? null,
          orderTrackingLink,
        }),
      });

      console.info('[admin order workflow] order-shipped webhook:', response.status, '— order_id:', orderId);
    } catch (error) {
      console.error('[admin order workflow] order-shipped webhook failed:', error, '— order_id:', orderId);
    }
  }
}
