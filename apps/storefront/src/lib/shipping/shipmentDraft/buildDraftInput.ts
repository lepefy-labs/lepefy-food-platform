import type { Order, ShippingPackagingProfileRow } from '@lepefy/types';
import { planTariffParcels } from '@/lib/shipping/tariff/tariffQuote';
import type { ProviderShipmentDraftInput, ShipmentDraftErrorCode } from '@/lib/shipping/providers/types';
import { shipmentOrderReference } from './shipmentDraftPresentation';

export { shipmentOrderReference };

/**
 * Pure: builds the provider-neutral draft request from a Lepefy order. Never
 * invents data: a missing recipient field, weight or box size is an explicit
 * error and the provider is not called.
 */

export interface DraftItemRow { product_id: string | null; name: string; quantity: number }
export type DraftCartonProfile = Pick<ShippingPackagingProfileRow,
  'id' | 'name' | 'box_length_cm' | 'box_width_cm' | 'box_height_cm' | 'active' | 'position' | 'is_default'
  | 'suggest_min_weight_g' | 'suggest_max_weight_g' | 'tare_g'>;
export interface DraftPackagingRow {
  max_pack_kg: number | null;
  box_length_cm: number | null;
  box_width_cm: number | null;
  box_height_cm: number | null;
}

export type DraftInputResult =
  | { ok: true; input: ProviderShipmentDraftInput; totalWeightG: number }
  | { ok: false; code: Extract<ShipmentDraftErrorCode, 'invalid_recipient' | 'invalid_parcel'>; detail: string };

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

/** Same default as loadCartonContext when packaging_surcharges has no max_pack_kg. */
const DEFAULT_MAX_PACK_KG = 15;

export function buildShipmentDraftInput({ order, items, productWeights, profiles, packaging, content, currency }: {
  order: Order;
  items: DraftItemRow[];
  productWeights: ReadonlyMap<string, number | null>;
  /** Active shipping_packaging_profiles: the cartons suggested to the team (« Carton à utiliser »). */
  profiles: DraftCartonProfile[];
  /** Active packaging_surcharges row: max parcel weight and last-resort box. */
  packaging: DraftPackagingRow | null;
  /** Tenant-declared content (shipping_automation.shipment_content). */
  content: string;
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
  // Same physical plan as the order's « Carton à utiliser » card and the flat-rate
  // availability check: filled parcels up to max_pack_kg, suggested carton per
  // parcel (then default profile, then the packaging_surcharges box), tare added
  // to the gross weight sent to the provider.
  const maxPackKg = Number(packaging?.max_pack_kg) > 0 ? Number(packaging!.max_pack_kg) : DEFAULT_MAX_PACK_KG;
  const box = packaging && Number(packaging.box_length_cm) > 0 && Number(packaging.box_width_cm) > 0 && Number(packaging.box_height_cm) > 0
    ? { length: Number(packaging.box_length_cm), width: Number(packaging.box_width_cm), height: Number(packaging.box_height_cm) }
    : null;
  const plan = planTariffParcels(totalWeightG, maxPackKg * 1000, profiles, box);
  if (!plan || plan.length === 0 || plan.some(parcel => !(parcel.lengthCm > 0 && parcel.widthCm > 0 && parcel.heightCm > 0))) {
    return { ok: false, code: 'invalid_parcel', detail: 'dimensions' };
  }
  const parcels = plan.map(parcel => ({
    weightKg: parcel.grossG / 1000, lengthCm: parcel.lengthCm, widthCm: parcel.widthCm, heightCm: parcel.heightCm,
  }));
  const declared = content.trim().slice(0, 60);
  if (!declared) return { ok: false, code: 'invalid_parcel', detail: 'contenu' };
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
      content: declared,
      contentValue: Math.max(0, Number(order.subtotal) || 0),
      currency,
    },
  };
}
