import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventReservation, EventReservationItem, EventRow, EventTicketType } from '@lepefy/types';
import { formatDate, formatPrice } from '@/lib/utils/format';

export interface ReservationExportItem extends EventReservationItem {
  ticket_type_label: string;
  remaining_quantity: number;
}

export interface ReservationExportRow extends EventReservation {
  items: ReservationExportItem[];
}

export interface EventReservationExportData {
  event: Pick<EventRow, 'id' | 'title' | 'date_start' | 'location'>;
  reservations: ReservationExportRow[];
  ticketTypes: EventTicketType[];
}

type RedemptionRow = {
  reservation_item_id: string;
  quantity_redeemed: number;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function csvCell(value: unknown): string {
  const text = String(value ?? '').replaceAll('"', '""');
  return `"${text}"`;
}

function tenantBrandHtml(tenantName: string, tenantLogoUrl: string | null, className: string): string {
  if (tenantLogoUrl) {
    return `<img class="${className}" src="${escapeHtml(tenantLogoUrl)}" alt="${escapeHtml(tenantName)}" />`;
  }
  return `<div class="tenant-name">${escapeHtml(tenantName)}</div>`;
}

function validReservations(data: EventReservationExportData): ReservationExportRow[] {
  return data.reservations.filter(
    (reservation) => reservation.status === 'confirmed' && reservation.quantity_remaining > 0,
  );
}

export async function loadEventReservationExportData(
  supabase: SupabaseClient,
  tenantId: string,
  eventId: string,
): Promise<EventReservationExportData | null> {
  const [{ data: event }, { data: reservationRows }, { data: ticketRows }] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, date_start, location')
      .eq('id', eventId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('event_reservations')
      .select('*')
      .eq('event_id', eventId)
      .eq('tenant_id', tenantId)
      .order('customer_name', { ascending: true }),
    supabase
      .from('event_ticket_types')
      .select('*')
      .eq('event_id', eventId)
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true }),
  ]);

  if (!event) return null;

  const reservations = (reservationRows ?? []) as EventReservation[];
  const ticketTypes = (ticketRows ?? []) as EventTicketType[];
  const reservationIds = reservations.map((reservation) => reservation.id);
  const { data: itemRows } = reservationIds.length > 0
    ? await supabase
        .from('event_reservation_items')
        .select('id, reservation_id, ticket_type_id, quantity, unit_price')
        .in('reservation_id', reservationIds)
    : { data: [] as EventReservationItem[] };

  const items = (itemRows ?? []) as EventReservationItem[];
  const itemIds = items.map((item) => item.id);
  const { data: redemptionRows } = itemIds.length > 0
    ? await supabase
        .from('event_reservation_item_redemptions')
        .select('reservation_item_id, quantity_redeemed')
        .in('reservation_item_id', itemIds)
        .is('voided_at', null)
    : { data: [] as RedemptionRow[] };

  const redeemedByItemId = new Map<string, number>();
  for (const redemption of (redemptionRows ?? []) as RedemptionRow[]) {
    redeemedByItemId.set(
      redemption.reservation_item_id,
      (redeemedByItemId.get(redemption.reservation_item_id) ?? 0) + redemption.quantity_redeemed,
    );
  }

  const labelByTicketId = new Map(ticketTypes.map((ticket) => [ticket.id, ticket.label]));
  const itemsByReservation = new Map<string, ReservationExportRow['items']>();
  for (const item of items) {
    const reservationItems = itemsByReservation.get(item.reservation_id) ?? [];
    reservationItems.push({
      ...item,
      ticket_type_label: labelByTicketId.get(item.ticket_type_id) ?? 'Formule',
      remaining_quantity: Math.max(0, item.quantity - (redeemedByItemId.get(item.id) ?? 0)),
    });
    itemsByReservation.set(item.reservation_id, reservationItems);
  }

  return {
    event: event as EventReservationExportData['event'],
    ticketTypes,
    reservations: reservations.map((reservation) => ({
      ...reservation,
      items: itemsByReservation.get(reservation.id) ?? [],
    })),
  };
}

export function buildReservationsCsv(data: EventReservationExportData, currency: string): string {
  const header = [
    'Référence', 'Client', 'Email', 'Téléphone', 'Statut', 'Personnes restantes',
    'Formule', 'Quantité restante', 'Prix unitaire', 'Valeur restante', 'Montant payé', 'Date réservation',
  ].map(csvCell).join(';');

  const rows = validReservations(data).flatMap((reservation) => {
    const validItems = reservation.items.filter((item) => item.remaining_quantity > 0);
    const itemsToExport: Array<ReservationExportItem | null> = validItems.length > 0 ? validItems : [null];
    return itemsToExport.map((item) => [
      reservation.id.slice(0, 8).toUpperCase(),
      reservation.customer_name,
      reservation.customer_email,
      reservation.customer_phone ?? '',
      reservation.status,
      reservation.quantity_remaining,
      item?.ticket_type_label ?? '',
      item?.remaining_quantity ?? '',
      item ? formatPrice(item.unit_price, currency) : '',
      item ? formatPrice(item.unit_price * item.remaining_quantity, currency) : '',
      formatPrice(reservation.amount_paid, currency),
      new Date(reservation.created_at).toLocaleString('fr-FR'),
    ].map(csvCell).join(';'));
  });

  return `\uFEFF${[header, ...rows].join('\n')}`;
}

function formulaSummary(data: EventReservationExportData): Array<{ label: string; quantity: number }> {
  const totals = new Map<string, number>();
  for (const reservation of validReservations(data)) {
    for (const item of reservation.items) {
      if (item.remaining_quantity <= 0) continue;
      totals.set(item.ticket_type_id, (totals.get(item.ticket_type_id) ?? 0) + item.remaining_quantity);
    }
  }
  return data.ticketTypes
    .map((ticket) => ({ label: ticket.label, quantity: totals.get(ticket.id) ?? 0 }))
    .filter((item) => item.quantity > 0);
}

export function buildReservationListHtml(
  data: EventReservationExportData,
  tenantName: string,
  tenantLogoUrl: string | null,
): string {
  const valid = validReservations(data);
  const people = valid.reduce((sum, reservation) => sum + reservation.quantity_remaining, 0);
  const summary = formulaSummary(data);
  const reservationRows = valid.map((reservation) => {
    const validItems = reservation.items.filter((item) => item.remaining_quantity > 0);
    return `
    <div class="reservation">
      <div class="check"></div>
      <div class="main">
        <div class="top"><strong>#${escapeHtml(reservation.id.slice(0, 8).toUpperCase())} · ${escapeHtml(reservation.customer_name)}</strong><span>${reservation.quantity_remaining} pers.</span></div>
        <div class="items">${validItems.map((item) => `${item.remaining_quantity} × ${escapeHtml(item.ticket_type_label)}`).join(' · ') || 'Détail formule indisponible'}</div>
        ${reservation.customer_phone ? `<div class="phone">${escapeHtml(reservation.customer_phone)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    @page { size: A4; margin: 11mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111; font-family: Arial, sans-serif; font-size: 10pt; }
    header { border-bottom: 2px solid #111; padding-bottom: 5mm; margin-bottom: 5mm; }
    .brand-row { min-height: 16mm; display: flex; align-items: center; margin-bottom: 2mm; }
    .tenant-logo { display: block; width: auto; height: auto; max-width: 46mm; max-height: 16mm; object-fit: contain; object-position: left center; }
    .tenant-name { font-size: 12pt; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
    h1 { margin: 1.5mm 0; font-size: 18pt; }
    .meta { color: #444; }
    .reservation { display: flex; gap: 4mm; padding: 3.2mm 0; border-bottom: 1px solid #bbb; break-inside: avoid; }
    .check { width: 6mm; height: 6mm; border: 1.5px solid #111; flex: 0 0 auto; margin-top: .4mm; }
    .main { flex: 1; }
    .top { display: flex; justify-content: space-between; gap: 8mm; font-size: 10.5pt; }
    .items { margin-top: 1.2mm; color: #333; }
    .phone { margin-top: .8mm; color: #666; font-size: 8.5pt; }
    .summary { margin-top: 7mm; padding-top: 4mm; border-top: 2px solid #111; break-inside: avoid; }
    .summary h2 { margin: 0 0 2mm; font-size: 11pt; }
    .summary-row { display: flex; justify-content: space-between; max-width: 95mm; padding: .8mm 0; }
  </style></head><body>
    <header><div class="brand-row">${tenantBrandHtml(tenantName, tenantLogoUrl, 'tenant-logo')}</div><h1>${escapeHtml(data.event.title)}</h1><div class="meta">${escapeHtml(formatDate(data.event.date_start))}${data.event.location ? ` · ${escapeHtml(data.event.location)}` : ''} · ${valid.length} réservations valides · ${people} personnes restantes</div></header>
    ${reservationRows || '<p>Aucun billet encore valide.</p>'}
    <section class="summary"><h2>Total encore valide · ${people} personnes</h2>${summary.map((item) => `<div class="summary-row"><span>${escapeHtml(item.label)}</span><strong>${item.quantity}</strong></div>`).join('')}</section>
  </body></html>`;
}

export function buildReservationTableCardsHtml(
  data: EventReservationExportData,
  tenantName: string,
  tenantLogoUrl: string | null,
  origin: string,
): string {
  const valid = validReservations(data);
  const cards = valid.map((reservation) => {
    const reference = reservation.id.slice(0, 8).toUpperCase();
    const qrUrl = `${origin}/api/events/reservation-qr?token=${encodeURIComponent(reservation.qr_token)}`;
    const validItems = reservation.items.filter((item) => item.remaining_quantity > 0);
    return `<section class="card">
      <div class="brand">${tenantBrandHtml(tenantName, tenantLogoUrl, 'tenant-logo')}</div>
      <div class="event">${escapeHtml(data.event.title)}</div>
      <div class="eyebrow">RÉSERVATION VALIDE</div>
      <div class="reference">#${escapeHtml(reference)}</div>
      <div class="customer">${escapeHtml(reservation.customer_name)}</div>
      <div class="people">${reservation.quantity_remaining} PERSONNE${reservation.quantity_remaining > 1 ? 'S' : ''} RESTANTE${reservation.quantity_remaining > 1 ? 'S' : ''}</div>
      <div class="items">${validItems.map((item) => `<div><strong>${item.remaining_quantity}×</strong> ${escapeHtml(item.ticket_type_label)}</div>`).join('')}</div>
      <img class="qr" src="${escapeHtml(qrUrl)}" alt="QR" />
    </section>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; font-family: Arial, sans-serif; color: #111; }
    .card { width: 210mm; height: 148.5mm; padding: 9mm 14mm 11mm; text-align: center; border-bottom: .4mm dashed #999; position: relative; break-inside: avoid; page-break-inside: avoid; overflow: hidden; }
    .card:nth-child(2n) { border-bottom: 0; page-break-after: always; }
    .brand { height: 18mm; display: flex; align-items: center; justify-content: center; }
    .tenant-logo { display: block; width: auto; height: auto; max-width: 54mm; max-height: 18mm; object-fit: contain; object-position: center; }
    .tenant-name { font-size: 12pt; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; color: #444; }
    .event { margin-top: 1.5mm; font-size: 14pt; font-weight: 700; }
    .eyebrow { margin-top: 4mm; font-size: 9pt; font-weight: 700; letter-spacing: .15em; color: #666; }
    .reference { margin-top: 1mm; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 34pt; line-height: 1; font-weight: 900; letter-spacing: .06em; }
    .customer { margin-top: 3mm; font-size: 14pt; font-weight: 700; }
    .people { margin-top: 1mm; font-size: 9pt; font-weight: 700; letter-spacing: .08em; color: #444; }
    .items { margin-top: 3mm; font-size: 10pt; line-height: 1.45; }
    .qr { position: absolute; right: 12mm; bottom: 9mm; width: 27mm; height: 27mm; }
  </style></head><body>${cards || '<p style="padding:20mm">Aucun billet encore valide.</p>'}</body></html>`;
}
