import type { NormalizedShipmentStatus, ShipmentTrackingEvent } from '@lepefy/types';

const LABELS: Record<NormalizedShipmentStatus, string> = {
  pending: 'En attente', ready_for_collection: 'Prêt pour enlèvement', in_transit: 'En transit',
  out_for_delivery: 'En livraison', delivered: 'Livré', exception: 'Incident', returned: 'Retourné',
  cancelled: 'Expédition annulée', unknown: 'Statut indisponible',
};
export function shipmentStatusLabel(status: NormalizedShipmentStatus | null | undefined): string {
  return status && status in LABELS ? LABELS[status] : LABELS.unknown;
}
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
