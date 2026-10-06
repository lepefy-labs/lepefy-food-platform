import { formatPrice } from '@/lib/utils/format';
import { groupSuggestedCartons, type CartonSuggestion } from '@/lib/shipping/cartonSuggestion';
import { formatDocumentDate, formatKg, orderShortRef, readableBrandColor, safeColor, safeImageUrl } from './documentHtml';
import { androidAppStatus } from '@/lib/mobileApp/androidApp';
import { formatWhatsappDisplay } from '@/lib/orders/portal/supportChannels';
import type { OrderDocumentsConfig } from './settings';

/**
 * View-models des documents de commande, construits champ par champ.
 *
 * - `InternalOrderDocumentViewModel` (liste de préparation, équipe) peut
 *   contenir emplacements, chaîne du froid et cartons.
 * - `CustomerOrderDocumentViewModel` (bon de colis, client) est assaini par
 *   construction : il ne reçoit jamais la ligne `orders` ni d'item brut, et
 *   aucun de ses types ne prévoit emplacement, e-mail, téléphone, note,
 *   paiement ou UUID. Les templates ne peuvent afficher que ce qu'il contient.
 */

export interface DocumentOrderRow {
  id: string;
  created_at: string;
  status: string;
  fulfillment_type: 'delivery' | 'pickup';
  full_name: string | null;
  shipping_address: Record<string, unknown> | null;
  shipping_details: Record<string, unknown> | null;
  shipping_cost: number | null;
  total: number | null;
}

export interface DocumentItemRow {
  order_id: string;
  product_id: string | null;
  name: string;
  name_alt: string | null;
  price: number | null;
  quantity: number;
  subtotal: number | null;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  warehouse_location: string | null;
}

export interface DocumentTenant {
  name: string;
  logo_url: string | null;
  primary_color: string | null;
  currency: string;
  storefront_url: string | null;
  whatsapp_number: string | null;
  legal_email: string | null;
  android_package_name: string | null;
  android_public: boolean | null;
}

// ─── Interne ────────────────────────────────────────────────────────────────

export interface PickingItemVM {
  name: string;
  nameAlt: string | null;
  quantity: number;
  storage: 'fresh' | 'frozen' | null;
  location: string | null;
}

export interface PickingCartonVM {
  lines: Array<{ count: number; name: string | null; dimensions: string | null; weights: string }>;
  parcels: Array<{ index: number; weight: string; carton: string | null; dimensions: string | null }>;
  alternatives: string[];
  totalWeight: string;
  maxParcelNote: string | null;
}

export interface InternalOrderDocumentViewModel {
  kind: 'picking_list';
  ref: string;
  createdAt: string;
  fulfillment: 'delivery' | 'pickup';
  fulfillmentLabel: string;
  tenantName: string;
  customerName: string;
  destination: string | null;
  /** Adresse complète (livraison uniquement), seulement si le tenant l'a activée. */
  deliveryAddress: string[] | null;
  items: PickingItemVM[];
  totalUnits: number;
  referenceCount: number;
  weight: string | null;
  parcelCount: number | null;
  cartons: PickingCartonVM | null;
  missingWeightLines: number;
}

export function sortPickingItems<T extends Pick<DocumentItemRow, 'warehouse_location'>>(items: T[]): T[] {
  return items.slice().sort((a, b) => {
    const la = a.warehouse_location ?? '';
    const lb = b.warehouse_location ?? '';
    if (!la && !lb) return 0;
    if (!la) return 1;
    if (!lb) return -1;
    return la.localeCompare(lb, 'fr', { numeric: true });
  });
}

function address(order: DocumentOrderRow): Record<string, string | undefined> {
  return (order.shipping_address ?? {}) as Record<string, string | undefined>;
}

/** Lignes d'adresse de livraison (nom, rue, complément, CP ville, pays), vides écartées. */
function addressLines(order: DocumentOrderRow): string[] | null {
  const a = address(order);
  const lines = [a.full_name ?? order.full_name ?? '', a.line1 ?? '', a.line2 ?? '', [a.postal_code, a.city].filter(Boolean).join(' '), a.country ?? '']
    .map((line) => String(line).trim()).filter(Boolean);
  return lines.length > 0 ? lines : null;
}

/**
 * Liste interne : le nom du client est déjà imprimé au-dessus, on ne répète le
 * destinataire que s'il diffère (cadeau). CP, ville et pays sur une ligne (A5).
 */
function pickingAddressLines(order: DocumentOrderRow): string[] | null {
  const a = address(order);
  const recipient = a.full_name?.trim();
  const customer = order.full_name?.trim();
  const lines = [
    recipient && recipient.toLowerCase() !== customer?.toLowerCase() ? `Destinataire : ${recipient}` : '',
    a.line1 ?? '', a.line2 ?? '',
    [[a.postal_code, a.city].filter(Boolean).join(' '), a.country].filter(Boolean).join(', '),
  ].map((line) => String(line).trim()).filter(Boolean);
  return lines.length > 0 ? lines : null;
}

function dims(carton: { box_length_cm: number; box_width_cm: number; box_height_cm: number } | null): string | null {
  return carton ? `${carton.box_length_cm} × ${carton.box_width_cm} × ${carton.box_height_cm} cm` : null;
}

export function buildPickingListViewModel(input: {
  order: DocumentOrderRow;
  items: DocumentItemRow[];
  tenant: Pick<DocumentTenant, 'name'>;
  carton: { suggestion: CartonSuggestion | null; missingWeightLines: number; maxParcelG?: number } | null;
  showDeliveryAddress?: boolean;
}): InternalOrderDocumentViewModel {
  const { order, tenant, carton } = input;
  const isPickup = order.fulfillment_type === 'pickup';
  const items = sortPickingItems(input.items).map<PickingItemVM>((item) => ({
    name: item.name,
    nameAlt: item.name_alt,
    quantity: item.quantity,
    storage: item.storage_type === 'fresh' || item.storage_type === 'frozen' ? item.storage_type : null,
    location: item.warehouse_location?.trim() || null,
  }));
  const a = address(order);
  const destination = isPickup ? null : [[a.postal_code, a.city].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ') || null;
  const suggestion = !isPickup ? carton?.suggestion ?? null : null;
  const checkoutWeight = Number((order.shipping_details as { totalWeightG?: unknown } | null)?.totalWeightG);
  const weightG = suggestion?.totalWeightG ?? (Number.isFinite(checkoutWeight) && checkoutWeight > 0 ? checkoutWeight : null);

  const cartons: PickingCartonVM | null = suggestion ? {
    lines: groupSuggestedCartons(suggestion).map((group) => ({
      count: group.count,
      name: group.carton?.name ?? null,
      dimensions: dims(group.carton),
      weights: group.weightsG.map(formatKg).join(' + '),
    })),
    parcels: suggestion.parcels.map((parcel, index) => ({
      index: index + 1,
      weight: formatKg(parcel.weightG),
      carton: parcel.carton?.name ?? null,
      dimensions: dims(parcel.carton),
    })),
    alternatives: Array.from(new Map(suggestion.parcels.flatMap((p) => p.alternatives).map((c) => [c.id, c])).values())
      .map((c) => `${c.name} (${dims(c)})`),
    totalWeight: formatKg(suggestion.totalWeightG),
    maxParcelNote: carton?.maxParcelG ? `Max. ${formatKg(carton.maxParcelG)} par colis` : null,
  } : null;

  return {
    kind: 'picking_list',
    ref: orderShortRef(order.id),
    createdAt: formatDocumentDate(order.created_at, 'short'),
    fulfillment: isPickup ? 'pickup' : 'delivery',
    fulfillmentLabel: isPickup ? 'RETRAIT' : 'LIVRAISON',
    tenantName: tenant.name,
    customerName: order.full_name?.trim() || 'Client',
    destination,
    deliveryAddress: input.showDeliveryAddress && !isPickup ? pickingAddressLines(order) : null,
    items,
    totalUnits: items.reduce((sum, item) => sum + item.quantity, 0),
    referenceCount: items.length,
    weight: weightG ? formatKg(weightG) : null,
    parcelCount: suggestion ? suggestion.parcels.length : null,
    cartons,
    missingWeightLines: suggestion ? carton?.missingWeightLines ?? 0 : 0,
  };
}

// ─── Client ─────────────────────────────────────────────────────────────────

export interface PackingSlipItemVM {
  name: string;
  nameAlt: string | null;
  quantity: number;
  unitPrice: string | null;
  lineTotal: string | null;
}

export interface PackingSlipQrVM {
  url: string;
  displayUrl: string;
  svg: string;
}

export interface CustomerOrderDocumentViewModel {
  kind: 'packing_slip';
  ref: string;
  date: string;
  greeting: string;
  tenant: { name: string; logoUrl: string | null; textColor: string; bandColor: string };
  items: PackingSlipItemVM[];
  totalUnits: number;
  prices: { lines: Array<{ label: string; value: string }>; total: string } | null;
  deliveryAddress: string[] | null;
  qr: PackingSlipQrVM | null;
  qrUnavailable: boolean;
  thankYou: string | null;
  contact: { website: string | null; whatsapp: string | null; email: string | null } | null;
  appNotice: string | null;
}

export function firstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first && first.length <= 40 ? first : null;
}

export function websiteLabel(storefrontUrl: string | null | undefined): string | null {
  if (!storefrontUrl) return null;
  try {
    return new URL(storefrontUrl).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function buildPackingSlipViewModel(input: {
  order: DocumentOrderRow;
  items: DocumentItemRow[];
  tenant: DocumentTenant;
  settings: OrderDocumentsConfig;
  qr: PackingSlipQrVM | null;
  /** QR demandé par les préférences mais jeton impossible à émettre (migration absente, secret manquant). */
  qrUnavailable?: boolean;
}): CustomerOrderDocumentViewModel {
  const { order, tenant, settings } = input;
  const showPrices = settings.packing_slip_show_prices;
  const currency = tenant.currency || 'EUR';
  const items = input.items.map<PackingSlipItemVM>((item) => ({
    name: item.name,
    nameAlt: item.name_alt,
    quantity: item.quantity,
    // Prix historiques de la commande (order_items), jamais le catalogue actuel.
    unitPrice: showPrices && item.price != null ? formatPrice(Number(item.price), currency) : null,
    lineTotal: showPrices && item.subtotal != null ? formatPrice(Number(item.subtotal), currency) : null,
  }));

  let prices: CustomerOrderDocumentViewModel['prices'] = null;
  if (showPrices) {
    const itemsTotal = input.items.reduce((sum, item) => sum + Number(item.subtotal ?? 0), 0);
    const shipping = order.fulfillment_type === 'delivery' ? Number(order.shipping_cost ?? 0) : 0;
    const total = Number(order.total ?? itemsTotal + shipping);
    const lines = [{ label: 'Articles', value: formatPrice(itemsTotal, currency) }];
    if (order.fulfillment_type === 'delivery') lines.push({ label: 'Livraison', value: shipping === 0 ? 'Offerte' : formatPrice(shipping, currency) });
    const reduction = Math.round((itemsTotal + shipping - total) * 100) / 100;
    if (reduction > 0) lines.push({ label: 'Réductions', value: `−${formatPrice(reduction, currency)}` });
    prices = { lines, total: formatPrice(total, currency) };
  }

  const deliveryAddress = settings.packing_slip_show_delivery_address && order.fulfillment_type === 'delivery' ? addressLines(order) : null;

  const name = firstName(order.full_name);
  const contact = settings.packing_slip_show_contact
    ? { website: websiteLabel(tenant.storefront_url), whatsapp: formatWhatsappDisplay(tenant.whatsapp_number), email: tenant.legal_email?.trim() || null }
    : null;

  return {
    kind: 'packing_slip',
    ref: orderShortRef(order.id),
    date: formatDocumentDate(order.created_at, 'long'),
    greeting: name ? `Merci ${name} !` : 'Merci !',
    tenant: {
      name: tenant.name,
      logoUrl: settings.packing_slip_show_logo ? safeImageUrl(tenant.logo_url) : null,
      textColor: readableBrandColor(tenant.primary_color),
      bandColor: safeColor(tenant.primary_color),
    },
    items,
    totalUnits: items.reduce((sum, item) => sum + item.quantity, 0),
    prices,
    deliveryAddress,
    qr: settings.packing_slip_show_qr ? input.qr : null,
    qrUnavailable: settings.packing_slip_show_qr && !input.qr && Boolean(input.qrUnavailable),
    thankYou: settings.packing_slip_show_thank_you
      ? `Merci d’avoir choisi ${tenant.name}. Nous espérons que vous apprécierez vos produits.`
      : null,
    contact: contact && (contact.website || contact.whatsapp || contact.email) ? contact : null,
    appNotice: androidAppStatus(tenant.android_package_name, tenant.android_public) === 'public' ? `Retrouvez ${tenant.name} sur Google Play.` : null,
  };
}
