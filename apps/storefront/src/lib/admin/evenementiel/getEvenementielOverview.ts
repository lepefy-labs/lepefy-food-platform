import { createServiceClient } from '@/lib/supabase/server';
import type { EventStatus, ServiceInquiryStatus } from '@lepefy/types';

export type OverviewActionTone = 'urgent' | 'attention' | 'default';
export type OverviewActionKind = 'Paiement' | 'Demande' | 'Location' | 'Capacité';

export interface OverviewAction {
  id: string;
  kind: OverviewActionKind;
  label: string;
  detail?: string;
  href: string;
  tone: OverviewActionTone;
}

export interface OverviewEvent {
  id: string;
  title: string;
  date_start: string;
  capacity_total: number;
  capacity_remaining: number;
  status: EventStatus;
}

export interface OverviewInquiry {
  id: string;
  customer_name: string;
  date_souhaitee: string | null;
  nombre_invites: number | null;
  status: ServiceInquiryStatus;
  created_at: string;
  service_offerings: { title: string } | null;
}

export interface OverviewRental {
  id: string;
  customer_name: string;
  pickup_date: string;
  status: 'confirmed' | 'cancelled' | 'refunded';
  items: { quantity: number; rental_items: { name: string } | null }[];
}

export interface EvenementielOverview {
  newInquiriesCount: number;
  pendingPaymentsCount: number;
  pendingPaymentsAmount: number;
  upcomingEventsCount: number;
  upcomingRentalCount: number;
  actions: OverviewAction[];
  upcomingEvents: OverviewEvent[];
  recentInquiries: OverviewInquiry[];
  upcomingRentals: OverviewRental[];
}

interface PendingEventRequest {
  id: string;
  event_id: string;
  customer_name: string;
  amount: number;
  created_at: string;
}

interface PendingRentalRequest {
  id: string;
  customer_name: string;
  amount: number;
  pickup_date: string;
  created_at: string;
}

function elapsedLabel(createdAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(Number(amount || 0));
}

export async function getEvenementielOverview(tenantId: string, currency: string): Promise<EvenementielOverview> {
  const supabase = createServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);

  const [
    upcomingEventsResult,
    upcomingEventsCountResult,
    recentInquiriesResult,
    newInquiriesCountResult,
    pendingEventRequestsResult,
    pendingRentalRequestsResult,
    upcomingRentalsResult,
    upcomingRentalCountResult,
  ] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, date_start, capacity_total, capacity_remaining, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'published')
      .gte('date_start', nowIso)
      .order('date_start', { ascending: true })
      .limit(5),
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'published')
      .gte('date_start', nowIso),
    supabase
      .from('service_inquiries')
      .select('id, customer_name, date_souhaitee, nombre_invites, status, created_at, service_offerings(title)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('service_inquiries')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'nouveau'),
    supabase
      .from('event_reservation_requests')
      .select('id, event_id, customer_name, amount, created_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    supabase
      .from('rental_reservation_requests')
      .select('id, customer_name, amount, pickup_date, created_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    supabase
      .from('rental_reservations')
      .select('id, customer_name, pickup_date, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'confirmed')
      .gte('pickup_date', today)
      .order('pickup_date', { ascending: true })
      .limit(5),
    supabase
      .from('rental_reservations')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'confirmed')
      .gte('pickup_date', today),
  ]);

  const upcomingEvents = (upcomingEventsResult.data ?? []) as OverviewEvent[];
  const recentInquiries = (recentInquiriesResult.data ?? []) as unknown as OverviewInquiry[];
  const pendingEventRequests = (pendingEventRequestsResult.data ?? []) as PendingEventRequest[];
  const pendingRentalRequests = (pendingRentalRequestsResult.data ?? []) as PendingRentalRequest[];
  const upcomingRentalRows = (upcomingRentalsResult.data ?? []) as Omit<OverviewRental, 'items'>[];

  const rentalIds = upcomingRentalRows.map((reservation) => reservation.id);
  const { data: rentalItems } = rentalIds.length > 0
    ? await supabase
        .from('rental_reservation_items')
        .select('reservation_id, quantity, rental_items(name)')
        .in('reservation_id', rentalIds)
    : { data: [] };

  const itemsByReservation = new Map<string, OverviewRental['items']>();
  for (const item of (rentalItems ?? []) as unknown as Array<{
    reservation_id: string;
    quantity: number;
    rental_items: { name: string } | null;
  }>) {
    const list = itemsByReservation.get(item.reservation_id) ?? [];
    list.push({ quantity: item.quantity, rental_items: item.rental_items });
    itemsByReservation.set(item.reservation_id, list);
  }

  const upcomingRentals: OverviewRental[] = upcomingRentalRows.map((reservation) => ({
    ...reservation,
    items: itemsByReservation.get(reservation.id) ?? [],
  }));

  const actions: OverviewAction[] = [];

  for (const request of pendingEventRequests.slice(0, 4)) {
    actions.push({
      id: `event-payment-${request.id}`,
      kind: 'Paiement',
      label: 'Paiement événement à confirmer',
      detail: `${request.customer_name} · ${formatAmount(request.amount, currency)} · ${elapsedLabel(request.created_at, now)}`,
      href: `/admin/evenementiel/evenements/${request.event_id}`,
      tone: 'attention',
    });
  }

  for (const request of pendingRentalRequests.slice(0, 4)) {
    actions.push({
      id: `rental-payment-${request.id}`,
      kind: 'Paiement',
      label: 'Paiement location à confirmer',
      detail: `${request.customer_name} · ${formatAmount(request.amount, currency)} · retrait ${new Date(request.pickup_date).toLocaleDateString('fr-FR')} · ${elapsedLabel(request.created_at, now)}`,
      href: '/admin/evenementiel/reservations-materiel',
      tone: 'attention',
    });
  }

  const newInquiriesCount = newInquiriesCountResult.count ?? 0;
  if (newInquiriesCount > 0) {
    actions.push({
      id: 'new-inquiries',
      kind: 'Demande',
      label: `${newInquiriesCount} nouvelle${newInquiriesCount > 1 ? 's' : ''} demande${newInquiriesCount > 1 ? 's' : ''} de devis`,
      detail: 'Nouveau contact à qualifier',
      href: '/admin/evenementiel/devis',
      tone: 'attention',
    });
  }

  const soonThreshold = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  for (const rental of upcomingRentals.filter((item) => new Date(item.pickup_date) <= soonThreshold).slice(0, 2)) {
    actions.push({
      id: `rental-soon-${rental.id}`,
      kind: 'Location',
      label: 'Location à préparer prochainement',
      detail: `${rental.customer_name} · retrait ${new Date(rental.pickup_date).toLocaleDateString('fr-FR')}`,
      href: '/admin/evenementiel/reservations-materiel',
      tone: 'default',
    });
  }

  for (const event of upcomingEvents) {
    if (event.capacity_total <= 0) continue;
    const remainingRatio = event.capacity_remaining / event.capacity_total;
    if (remainingRatio <= 0.2) {
      actions.push({
        id: `capacity-${event.id}`,
        kind: 'Capacité',
        label: 'Capacité événement à surveiller',
        detail: `${event.title} · ${event.capacity_remaining} place${event.capacity_remaining > 1 ? 's' : ''} restante${event.capacity_remaining > 1 ? 's' : ''}`,
        href: `/admin/evenementiel/evenements/${event.id}`,
        tone: 'default',
      });
    }
  }

  const pendingPaymentsAmount = [...pendingEventRequests, ...pendingRentalRequests]
    .reduce((sum, request) => sum + Number(request.amount || 0), 0);

  return {
    newInquiriesCount,
    pendingPaymentsCount: pendingEventRequests.length + pendingRentalRequests.length,
    pendingPaymentsAmount,
    upcomingEventsCount: upcomingEventsCountResult.count ?? 0,
    upcomingRentalCount: upcomingRentalCountResult.count ?? 0,
    actions: actions.slice(0, 8),
    upcomingEvents,
    recentInquiries,
    upcomingRentals,
  };
}
