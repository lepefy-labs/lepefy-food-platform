/**
 * Commande telle que la montre la page de confirmation à son client
 * (POST /api/checkout-sessions/[id]/order). Construite champ par champ, jamais
 * la ligne `orders` : pas de téléphone, de moyen de paiement détaillé, de
 * notes ni d'adresse complète (code postal, ville, pays seulement). L'e-mail
 * est celui du client lui-même, affiché tel quel.
 */

export interface ConfirmationOrderRow {
  id: string;
  email: string | null;
  fulfillment_type: string | null;
  payment_method: string | null;
  shipping_address: { postal_code?: string | null; city?: string | null; country?: string | null } | null;
  shipping_cost: number | string | null;
  subtotal: number | string | null;
  total: number | string | null;
}

export interface ConfirmationOrderItemRow {
  id: string;
  name: string;
  quantity: number;
  subtotal: number | string | null;
}

export interface ConfirmationOrderView {
  reference: string;
  email: string | null;
  fulfillmentType: 'delivery' | 'pickup';
  deliveryPlace: string | null;
  items: Array<{ id: string; name: string; quantity: number; subtotal: number }>;
  subtotal: number;
  shippingCost: number;
  total: number;
  trackingUrl: string | null;
}

export type ConfirmationResponse =
  | { status: 'pending'; email: string | null }
  | { status: 'ready'; order: ConfirmationOrderView };

function amount(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Même référence que la page et les e-mails : 8 premiers caractères de l'id, en majuscules. */
export function orderReference(orderId: string): string {
  return orderId.slice(0, 8).toUpperCase();
}

export function buildConfirmationOrderView(
  order: ConfirmationOrderRow,
  items: readonly ConfirmationOrderItemRow[],
  trackingUrl: string | null,
): ConfirmationOrderView {
  const fulfillmentType = order.fulfillment_type === 'pickup' ? 'pickup' : 'delivery';
  const address = order.shipping_address;
  const place = [[address?.postal_code, address?.city].filter(Boolean).join(' '), address?.country]
    .filter((part) => typeof part === 'string' && part.trim().length > 0)
    .join(', ');
  return {
    reference: orderReference(order.id),
    email: order.email ?? null,
    fulfillmentType,
    deliveryPlace: fulfillmentType === 'delivery' && place ? place : null,
    items: items.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, subtotal: amount(item.subtotal) })),
    subtotal: amount(order.subtotal),
    shippingCost: amount(order.shipping_cost),
    total: amount(order.total),
    trackingUrl,
  };
}
