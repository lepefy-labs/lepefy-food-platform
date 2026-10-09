import type { Order } from '@lepefy/types';
import { splitIntoParcels } from '@/lib/shipping/calculateShipping';
import type { ProviderShipmentDraftInput, ShipmentDraftErrorCode } from '@/lib/shipping/providers/types';

/**
 * Pure: builds the provider-neutral draft request from a Lepefy order. Never
 * invents data: a missing recipient field, weight or box size is an explicit
 * error and the provider is not called.
 */

export interface DraftItemRow { product_id: string | null; name: string; quantity: number }
export interface DraftPackagingRow {
  max_pack_kg: number | null;
  box_length_cm: number | null;
  box_width_cm: number | null;
  box_height_cm: number | null;
}

export type DraftInputResult =
  | { ok: true; input: ProviderShipmentDraftInput; totalWeightG: number }
  | { ok: false; code: Extract<ShipmentDraftErrorCode, 'invalid_recipient' | 'invalid_parcel'>; detail: string };

/** Same 8-character reference as the admin order number (`orderNumberFor`: #3F2A91C0). */
export function shipmentOrderReference(orderId: string): string {
  return `LEPEFY-${orderId.slice(0, 8).toUpperCase()}`;
}

/**
 * The customer phone is persisted only as the `Téléphone: …` line written into
 * orders.notes by every order-creation path (Stripe webhook, conversion RPC
 * 128, in-store checkout).
 */
export function orderContactPhone(notes: string | null | undefined): string | null {
  const match = /(?:^|\n)\s*Téléphone\s*:\s*([^\n]+)/i.exec(notes ?? '');
  const phone = match?.[1]?.trim() ?? '';
  return phone.replace(/\D/g, '').length >= 6 ? phone.slice(0, 40) : null;
}

export function splitRecipientName(fullName: string): { firstName: string; lastName: string | null } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: null };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1]! };
}

const clean = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Weight: orders.shipping_details.totalWeightG (checkout snapshot) first, then
 * Σ order_items.quantity × products.weight_grams — only when every line has a
 * product weight (no WEIGHT_FALLBACK_G guess).
 */
export function resolveOrderWeightG(order: Pick<Order, 'shipping_details'>, items: DraftItemRow[], productWeights: ReadonlyMap<string, number | null>): number | null {
  const snapshot = Number((order.shipping_details as { totalWeightG?: unknown } | null)?.totalWeightG);
  if (Number.isFinite(snapshot) && snapshot > 0) return Math.round(snapshot);
  if (items.length === 0) return null;
  let total = 0;
  for (const item of items) {
    const weight = item.product_id ? productWeights.get(item.product_id) : null;
    if (typeof weight !== 'number' || !(weight > 0) || !(item.quantity > 0)) return null;
    total += weight * item.quantity;
  }
  return total > 0 ? Math.round(total) : null;
}

export function buildShipmentDraftInput({ order, items, productWeights, packaging, currency }: {
  order: Order;
  items: DraftItemRow[];
  productWeights: ReadonlyMap<string, number | null>;
  /** Active packaging_surcharges row: the same parcel rule as the checkout quote. */
  packaging: DraftPackagingRow | null;
  currency: string;
}): DraftInputResult {
  const address = (order.shipping_address ?? {}) as unknown as Record<string, unknown>;
  const fullName = clean(address.full_name, 120) || clean(order.full_name, 120);
  const street1 = clean(address.line1, 120);
  const postalCode = clean(address.postal_code, 20);
  const city = clean(address.city, 80);
  const country = clean(address.country, 2).toUpperCase();
  const phone = orderContactPhone(order.notes);
  const missing = [
    !fullName && 'nom', !street1 && 'adresse', !postalCode && 'code postal', !city && 'ville',
    !/^[A-Z]{2}$/.test(country) && 'pays', !phone && 'téléphone',
  ].filter((value): value is string => Boolean(value));
  if (missing.length) return { ok: false, code: 'invalid_recipient', detail: missing.join(', ') };

  const totalWeightG = resolveOrderWeightG(order, items, productWeights);
  if (!totalWeightG) return { ok: false, code: 'invalid_parcel', detail: 'poids' };
  const box = packaging;
  if (!box || !(Number(box.max_pack_kg) > 0) || !(Number(box.box_length_cm) > 0)
    || !(Number(box.box_width_cm) > 0) || !(Number(box.box_height_cm) > 0)) {
    return { ok: false, code: 'invalid_parcel', detail: 'dimensions' };
  }
  const parcels = splitIntoParcels(totalWeightG, Number(box.max_pack_kg)).map(weightG => ({
    weightKg: weightG / 1000, lengthCm: Number(box.box_length_cm), widthCm: Number(box.box_width_cm), heightCm: Number(box.box_height_cm),
  }));

  const content = items.map(item => `${item.quantity}x ${item.name.trim()}`).join(', ').replace(/[^\p{L}\p{N} ,.'x×-]/gu, '').slice(0, 60)
    || 'Produits alimentaires';
  const { firstName, lastName } = splitRecipientName(fullName);
  return {
    ok: true,
    totalWeightG,
    input: {
      orderReference: shipmentOrderReference(order.id),
      recipient: {
        firstName, lastName, street1, street2: clean(address.line2, 120) || null, postalCode, city, country, phone: phone!,
        email: clean(order.email, 160) || null,
      },
      parcels,
      content,
      contentValue: Math.max(0, Number(order.subtotal) || 0),
      currency,
    },
  };
}
