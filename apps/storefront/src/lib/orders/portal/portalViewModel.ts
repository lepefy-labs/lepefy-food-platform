import type { NormalizedShipmentStatus } from '@lepefy/types';
import { getCustomerOrderPresentation, type CustomerOrderStage, type FulfillmentKind } from '@/lib/orders/orderStatus';
import { carrierDisplayName, safeShipmentTrackingUrl, shipmentEventsNewestFirst, shipmentStatusLabel } from '@/lib/shipping/shipmentPresentation';
import { androidAppStatus } from '@/lib/mobileApp/androidApp';
import { orderShortRef, safeImageUrl } from '@/lib/orders/documents/documentHtml';
import { buildSupportChannels, type SupportChannel } from './supportChannels';

/**
 * View-model du portail public `/o/[token]`, minimal par construction : il
 * ne contient ni nom, ni e-mail, ni téléphone, ni adresse de livraison, ni
 * prix, ni paiement, ni UUID. Le QR reste le même ; ce sont les actions qui
 * suivent le cycle de vie (commande → aide → fidélisation).
 */
export interface PortalOrderRow {
  id: string;
  created_at: string;
  status: string;
  fulfillment_type: FulfillmentKind;
  tracking_code: string | null;
  tracking_carrier: string | null;
  shipping_details: Record<string, unknown> | null;
  shipping_tracking_mode?: 'managed' | 'manual' | null;
  shipping_normalized_status?: NormalizedShipmentStatus | null;
  shipping_tracking_url?: string | null;
  shipping_estimated_delivery_at?: string | null;
  shipping_tracking_events?: unknown;
}

export interface PortalTenant {
  name: string;
  logo_url: string | null;
  whatsapp_number: string | null;
  legal_email: string | null;
  click_collect_address: string | null;
  click_collect_hours: string | null;
  google_maps_url: string | null;
  android_package_name: string | null;
  android_public: boolean | null;
}

export type PortalCta =
  | { kind: 'track'; label: string; href: string }
  | { kind: 'maps'; label: string; href: string }
  | { kind: 'reorder'; label: string }
  | { kind: 'review'; label: string }
  | { kind: 'support'; label: string };

export interface OrderPortalViewModel {
  ref: string;
  date: string;
  stage: CustomerOrderStage;
  stageLabel: string;
  headline: string;
  description: string;
  fulfillment: FulfillmentKind;
  shipment: { carrier: string | null; status: string | null; eta: string | null; lastUpdate: string | null; trackingCode: string | null } | null;
  pickup: { address: string; hours: string | null } | null;
  items: Array<{ name: string; quantity: number }>;
  primary: PortalCta | null;
  secondary: PortalCta[];
  support: SupportChannel[];
  appUrl: string | null;
  tenant: { name: string; logoUrl: string | null };
}

const SHORT_DATE = (iso: string, withYear = false) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'Europe/Paris' }).format(new Date(iso));

function validDate(iso: string | null | undefined): iso is string {
  return Boolean(iso && Number.isFinite(Date.parse(iso)));
}

export function buildOrderPortalViewModel(input: {
  order: PortalOrderRow;
  items: Array<{ name: string; quantity: number }>;
  tenant: PortalTenant;
  shopBaseUrl: string | null;
  reviewAvailable: boolean;
  reorderAvailable: boolean;
}): OrderPortalViewModel {
  const { order, tenant } = input;
  const presentation = getCustomerOrderPresentation(order.status, order.fulfillment_type);
  const ref = orderShortRef(order.id);
  const isPickup = order.fulfillment_type === 'pickup';
  const stage = presentation.stage;
  const sd = (order.shipping_details ?? {}) as { carrierName?: string; trackingCode?: string; trackingCarrier?: string };

  // Lien transporteur : seulement l'URL persistée et validée (https, sans identifiants).
  const trackingUrl = !isPickup ? safeShipmentTrackingUrl(order.shipping_tracking_url) : null;
  const events = shipmentEventsNewestFirst(order.shipping_tracking_events);
  const delivered = stage === 'delivered';
  const shipment = !isPickup && (stage === 'shipped' || delivered || order.shipping_tracking_mode === 'managed') ? {
    carrier: carrierDisplayName(order.tracking_carrier ?? sd.trackingCarrier ?? sd.carrierName),
    status: order.shipping_normalized_status ? shipmentStatusLabel(order.shipping_normalized_status) : null,
    eta: !delivered && validDate(order.shipping_estimated_delivery_at) ? SHORT_DATE(order.shipping_estimated_delivery_at) : null,
    lastUpdate: events[0] ? SHORT_DATE(events[0].occurredAt) : null,
    trackingCode: order.tracking_code ?? sd.trackingCode ?? null,
  } : null;

  const headline = stage === 'shipped' ? 'Votre livraison est en cours' : presentation.title;

  let primary: PortalCta | null = null;
  const secondary: PortalCta[] = [];
  if (delivered) {
    if (input.reorderAvailable) primary = { kind: 'reorder', label: 'Commander à nouveau' };
    if (input.reviewAvailable) secondary.push({ kind: 'review', label: 'Donner mon avis' });
  } else if (stage === 'shipped' && trackingUrl) {
    primary = { kind: 'track', label: 'Suivre ma livraison', href: trackingUrl };
  } else if (stage === 'ready_for_pickup' && tenant.google_maps_url && safeShipmentTrackingUrl(tenant.google_maps_url)) {
    primary = { kind: 'maps', label: 'Itinéraire', href: safeShipmentTrackingUrl(tenant.google_maps_url)! };
  } else if (trackingUrl && stage !== 'cancelled') {
    secondary.push({ kind: 'track', label: 'Suivre ma livraison', href: trackingUrl });
  }

  const support = buildSupportChannels(tenant, ref, input.shopBaseUrl);
  if (support.length > 0) secondary.push({ kind: 'support', label: 'Besoin d’aide ?' });

  return {
    ref,
    date: SHORT_DATE(order.created_at, true),
    stage,
    stageLabel: presentation.label,
    headline,
    description: presentation.description,
    fulfillment: order.fulfillment_type,
    shipment,
    pickup: isPickup && tenant.click_collect_address && stage !== 'cancelled'
      ? { address: tenant.click_collect_address, hours: tenant.click_collect_hours } : null,
    items: input.items.map((item) => ({ name: item.name, quantity: item.quantity })),
    primary,
    secondary,
    support,
    appUrl: androidAppStatus(tenant.android_package_name, tenant.android_public) === 'public' ? '/go' : null,
    tenant: { name: tenant.name, logoUrl: safeImageUrl(tenant.logo_url) },
  };
}
