import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import { createEventReservationFromRequest } from '@/lib/events/createEventReservationFromRequest';
import { getTicketUrl } from '@/lib/events/ticketUrl';
import type { EventCheckoutItemInput, EventReservation, EventReservationItem, EventTicketType } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const adminId = await getAdminId();
  if (!adminId) return NextResponse.json({ error: 'Session administrateur invalide.' }, { status: 401 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Données invalides.' }, { status: 400 });

  const eventId = String(body.event_id ?? '').trim();
  const customerName = String(body.customer_name ?? '').trim();
  const customerEmail = String(body.customer_email ?? '').trim().toLowerCase();
  const customerPhone = String(body.customer_phone ?? '').trim();
  const rawItems = Array.isArray(body.items) ? body.items : [];

  if (!eventId || !customerName || !EMAIL_RE.test(customerEmail)) {
    return NextResponse.json({ error: 'Nom, e-mail et événement valides requis.' }, { status: 400 });
  }

  const quantityByTicket = new Map<string, number>();
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as Record<string, unknown>;
    const ticketTypeId = String(item.ticket_type_id ?? '').trim();
    const quantity = Number(item.quantity);
    if (!ticketTypeId || !Number.isInteger(quantity) || quantity <= 0 || quantity > 100) {
      return NextResponse.json({ error: 'Quantités de formules invalides.' }, { status: 400 });
    }
    quantityByTicket.set(ticketTypeId, (quantityByTicket.get(ticketTypeId) ?? 0) + quantity);
  }

  const items: EventCheckoutItemInput[] = Array.from(quantityByTicket, ([ticket_type_id, quantity]) => ({ ticket_type_id, quantity }));
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  if (items.length === 0 || totalQuantity <= 0 || totalQuantity > 100) {
    return NextResponse.json({ error: 'Sélectionnez au moins une formule valide.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: event } = await supabase
    .from('events')
    .select('id, status')
    .eq('id', eventId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!event) return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });
  if (event.status !== 'published') {
    return NextResponse.json({ error: 'Les réservations en magasin sont disponibles uniquement pour un événement publié.' }, { status: 409 });
  }

  const { data: ticketRows, error: ticketError } = await supabase
    .from('event_ticket_types')
    .select('id, tenant_id, event_id, label, description, price, sort_order, active, badge')
    .eq('tenant_id', tenant.id)
    .eq('event_id', eventId)
    .eq('active', true)
    .in('id', items.map((item) => item.ticket_type_id));

  if (ticketError) return NextResponse.json({ error: ticketError.message }, { status: 500 });
  const ticketTypes = (ticketRows ?? []) as EventTicketType[];
  if (ticketTypes.length !== items.length) {
    return NextResponse.json({ error: 'Une formule sélectionnée est inactive ou n’appartient pas à cet événement.' }, { status: 409 });
  }

  const priceById = new Map(ticketTypes.map((ticket) => [ticket.id, Number(ticket.price)]));
  const amountPaid = Math.round(items.reduce((sum, item) => sum + (priceById.get(item.ticket_type_id) ?? 0) * item.quantity, 0) * 100) / 100;

  const result = await createEventReservationFromRequest(supabase, {
    eventId,
    tenantId: tenant.id,
    items,
    customerName,
    customerEmail,
    customerPhone,
    amountPaid,
    source: 'admin_in_store',
    paymentMethod: 'in_store',
    createdByAdminId: adminId,
  });

  if ('error' in result) {
    if (result.error === 'stock_conflict') {
      return NextResponse.json({ error: 'Capacité insuffisante : la réservation n’a pas été créée.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Impossible de créer la réservation.' }, { status: 500 });
  }

  const { data: reservationRow, error: reservationError } = await supabase
    .from('event_reservations')
    .select('*')
    .eq('id', result.reservationId)
    .eq('tenant_id', tenant.id)
    .single();

  if (reservationError || !reservationRow) {
    return NextResponse.json({ error: 'Réservation créée, mais impossible de relire son détail.' }, { status: 500 });
  }

  const { data: itemRows } = await supabase
    .from('event_reservation_items')
    .select('id, reservation_id, ticket_type_id, quantity, unit_price')
    .eq('reservation_id', result.reservationId);

  const labelById = new Map(ticketTypes.map((ticket) => [ticket.id, ticket.label]));
  const enrichedItems = ((itemRows ?? []) as EventReservationItem[]).map((item) => ({
    ...item,
    ticket_type_label: labelById.get(item.ticket_type_id) ?? 'Formule',
  }));

  return NextResponse.json({
    reservation: { ...(reservationRow as EventReservation), items: enrichedItems },
    ticketUrl: getTicketUrl((reservationRow as EventReservation).qr_token),
  }, { status: 201 });
}
