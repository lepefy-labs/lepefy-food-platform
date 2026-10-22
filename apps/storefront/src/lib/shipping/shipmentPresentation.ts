import type { NormalizedShipmentStatus, ShipmentTrackingEvent } from '@lepefy/types';

const LABELS: Record<NormalizedShipmentStatus, string> = {
  pending: 'En attente', ready_for_collection: 'Prêt pour enlèvement', in_transit: 'En transit',
  out_for_delivery: 'En livraison', delivered: 'Livré', exception: 'Incident', returned: 'Retourné',
  cancelled: 'Expédition annulée', unknown: 'Statut indisponible',
};
export function shipmentStatusLabel(status: NormalizedShipmentStatus | null | undefined): string {
  return status && status in LABELS ? LABELS[status] : LABELS.unknown;
}
/** `shipping_sync_error` when the carrier moved the parcel but picking/packing is not recorded in Lepefy. */
export const SHIPPING_SYNC_PREPARATION_INCOMPLETE = 'preparation_incomplete';
export function shipmentEventLabel(event: ShipmentTrackingEvent): string {
  const known: Record<string, string> = {
    RITIRATA: 'Pris en charge', 'DATI SPEDIZ. TRASMESSI A BRT': 'Données transmises au transporteur',
    PARTITA: 'Parti', 'IN CONSEGNA': 'En livraison', 'DA RITIRARE AL PARCEL SHOP': 'À retirer au Parcel Shop',
    CONSEGNATA: 'Livré',
  };
  return known[event.description.trim().toUpperCase()] ?? event.description;
}
export function shipmentDate(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(new Date(value));
}
export function safeShipmentTrackingUrl(value: string | null | undefined): string | null {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}
export function shipmentEventsNewestFirst(value: unknown): ShipmentTrackingEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((event): event is ShipmentTrackingEvent => event && typeof event === 'object'
    && typeof event.occurredAt === 'string' && Number.isFinite(Date.parse(event.occurredAt))
    && typeof event.description === 'string' && typeof event.status === 'string')
    .slice(-100).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

const CARRIER_NAMES: Record<string, string> = {
  brt: 'BRT', bartolini: 'BRT', dhl: 'DHL', fedex: 'FedEx', tnt: 'TNT',
  gls: 'GLS', ups: 'UPS', sda: 'SDA', poste: 'Poste Italiane',
  'poste italiane': 'Poste Italiane', poste_italiane: 'Poste Italiane', dpd: 'DPD', nexive: 'Nexive',
};
const POSTE_TRACKING_BASE = 'https://www.poste.it/cerca/index.html#/risultati-spedizioni/';
/** Carrier pages that open directly on one shipment when the code is appended. */
const CARRIER_TRACKING_BASES: Record<string, string> = {
  'poste italiane': POSTE_TRACKING_BASE, poste: POSTE_TRACKING_BASE, poste_italiane: POSTE_TRACKING_BASE,
  brt: 'https://vas.brt.it/vas/sped_det_show.hsm?referer=sped_numsped_par.hsm&Nspediz=',
  bartolini: 'https://vas.brt.it/vas/sped_det_show.hsm?referer=sped_numsped_par.hsm&Nspediz=',
  fedex: 'https://www.fedex.com/fedextrack/?trknbr=',
  tnt: 'https://www.tnt.com/express/it_it/site/tracking.html?searchType=CON&cons=',
  dhl: 'https://www.dhl.com/it-it/home/tracking.html?tracking-id=',
  sda: 'https://www.sda.it/wps/portal/Servizi-online/cerca-spedizione?barcode=',
  ups: 'https://www.ups.com/track?tracknum=',
};

/**
 * One carrier link for the customer page, the QR portal and the admin order:
 * it always opens on the shipment itself. The provider URL (Packlink) is kept
 * when it already carries the tracking code; otherwise a known carrier gets
 * its own page with the code appended (Poste Italiane: the old
 * `risultati-ricerca-spedizioni` route drops the code and shows an empty search).
 */
export function carrierTrackingLink(input: {
  carrier: string | null | undefined; trackingCode: string | null | undefined; providerUrl?: string | null;
}): string | null {
  const code = input.trackingCode?.trim() || null;
  const provider = safeShipmentTrackingUrl(input.providerUrl);
  const repairedProvider = provider?.replace('#/risultati-ricerca-spedizioni/', '#/risultati-spedizioni/') ?? null;
  if (repairedProvider && (!code || repairedProvider.includes(code) || repairedProvider.includes(encodeURIComponent(code)))) return repairedProvider;
  const base = input.carrier ? CARRIER_TRACKING_BASES[input.carrier.toLowerCase().trim()] : undefined;
  if (base && code) return `${base}${encodeURIComponent(code)}`;
  return repairedProvider;
}

/** Carrier name as staff expect to read it ("brt" → "BRT"); unknown names are kept as typed. */
export function carrierDisplayName(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  return CARRIER_NAMES[value.toLowerCase()] ?? value;
}
