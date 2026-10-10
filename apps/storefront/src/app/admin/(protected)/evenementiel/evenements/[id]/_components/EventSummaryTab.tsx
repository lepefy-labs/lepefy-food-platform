'use client';

import Link from 'next/link';
import { IconCheck, IconExternalLink, IconScan, IconAlertTriangle } from '@tabler/icons-react';
import type { EventReservation, EventReservationRequest, EventRow, EventTicketType } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';
import EventBookingDeadlineAdminCard from './EventBookingDeadlineAdminCard';
import EventCapacityManager from './EventCapacityManager';

function elapsedLabel(createdAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

export default function EventSummaryTab({
  event,
  ticketTypes,
  reservations,
  pendingRequests,
  currency,
  canManageCapacity = true,
  onOpenReservations,
  onOpenPage,
  onCloseEvent,
}: {
  event: EventRow;
  ticketTypes: EventTicketType[];
  reservations: EventReservation[];
  pendingRequests: EventReservationRequest[];
  currency: string;
  canManageCapacity?: boolean;
  onPendingConfirmed?: (id: string, warning?: string) => void;
  onOpenReservations: () => void;
  onOpenPage: () => void;
  onCloseEvent: () => void;
}) {
  const activeTickets = ticketTypes.filter((ticket) => ticket.active);
  const confirmedReservations = reservations.filter((reservation) => reservation.status === 'confirmed');
  const reservedPlaces = Math.max(0, event.capacity_total - event.capacity_remaining);
  const occupancy = event.capacity_total > 0 ? Math.round((reservedPlaces / event.capacity_total) * 100) : 0;
  const revenue = confirmedReservations.reduce((sum, reservation) => sum + Number(reservation.amount_paid || 0), 0);
  const pendingAmount = pendingRequests.reduce((sum, request) => sum + Number(request.amount || 0), 0);
  const publicEnabled = event.status !== 'draft' && event.status !== 'cancelled';

  const readiness = [
    { label: 'Date et heure définies', meta: new Date(event.date_start).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }), ok: Boolean(event.date_start), required: true },
    { label: 'Capacité configurée', meta: `${event.capacity_total} places`, ok: event.capacity_total > 0, required: true },
    { label: 'Formules actives', meta: `${activeTickets.length} formule${activeTickets.length > 1 ? 's' : ''} active${activeTickets.length > 1 ? 's' : ''}`, ok: activeTickets.length > 0, required: true },
    { label: 'Bannière ajoutée', meta: event.banner_image_url ? 'Image principale configurée' : 'Aucune bannière', ok: Boolean(event.banner_image_url), required: false },
    { label: 'Présentation enrichie', meta: event.subtitle || (event.highlights?.length ?? 0) > 0 ? 'Contenu de présentation configuré' : 'Sous-titre ou points forts recommandés', ok: Boolean(event.subtitle || (event.highlights?.length ?? 0) > 0), required: false },
  ];
  const readinessDone = readiness.filter((item) => item.ok).length;
  const metricClass = 'rounded-xl border border-a-border bg-a-surface p-3.5';
  const cardClass = 'overflow-hidden rounded-xl border border-a-border bg-a-surface';

  return (
    <div className="mt-5 space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={metricClass}><p className="text-xs text-a-text-3">Réservations</p><p className="mt-1 text-2xl font-semibold text-a-text">{confirmedReservations.length}</p><p className="mt-1 text-xs text-a-text-3">{reservedPlaces} places réservées</p></div>
        <div className={metricClass}><p className="text-xs text-a-text-3">Occupation</p><p className="mt-1 text-2xl font-semibold text-a-text">{occupancy}%</p><p className="mt-1 text-xs text-a-text-3">{event.capacity_remaining} places restantes</p></div>
        <div className={metricClass}><p className="text-xs text-a-text-3">Chiffre d’affaires</p><p className="mt-1 text-2xl font-semibold text-a-text">{formatPrice(revenue, currency)}</p><p className="mt-1 text-xs text-a-text-3">réservations confirmées</p></div>
        <div className={`${metricClass} ${pendingRequests.length > 0 ? 'border-tone-warning-border' : ''}`}><p className="text-xs text-a-text-3">Paiements à vérifier</p><p className="mt-1 text-2xl font-semibold text-a-text">{pendingRequests.length}</p><p className="mt-1 text-xs text-a-text-3">{pendingRequests.length > 0 ? `${formatPrice(pendingAmount, currency)} en attente` : 'Aucun paiement en attente'}</p></div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,.8fr)]">
        <div className="space-y-4">
          <section className={cardClass}>
            <div className="flex items-center justify-between border-b border-a-border px-4 py-3"><div><h2 className="text-sm font-semibold text-a-text">Prêt à publier</h2><p className="mt-0.5 text-xs text-a-text-3">Checklist dérivée des données de l’événement.</p></div><span className="rounded-full bg-tone-warning-bg px-2 py-1 text-xs font-semibold text-tone-warning-fg">{readinessDone} / {readiness.length}</span></div>
            <div className="divide-y divide-a-border">{readiness.map((item) => <div key={item.label} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-2.5"><span className={`grid h-5 w-5 place-items-center rounded-full ${item.ok ? 'bg-tone-success-bg text-tone-success-fg' : item.required ? 'bg-tone-danger-bg text-tone-danger-fg' : 'bg-tone-warning-bg text-tone-warning-fg'}`}>{item.ok ? <IconCheck size={12} /> : <IconAlertTriangle size={12} />}</span><div><p className="text-sm font-medium text-a-text">{item.label}</p><p className="text-xs text-a-text-3">{item.meta}</p></div>{!item.ok && !item.required && <button type="button" onClick={onOpenPage} className="min-h-9 text-xs font-semibold text-a-brand-fg">Compléter</button>}</div>)}</div>
            <div className="border-t border-a-border px-4 py-3"><div className="mb-1.5 flex justify-between text-xs text-a-text-3"><span>Configuration</span><strong>{Math.round((readinessDone / readiness.length) * 100)}%</strong></div><div className="h-1.5 overflow-hidden rounded-full bg-a-hover"><div className="h-full rounded-full bg-a-brand" style={{ width: `${Math.round((readinessDone / readiness.length) * 100)}%` }} /></div></div>
          </section>

          <section className={cardClass}><div className="flex items-center justify-between gap-3 border-b border-a-border px-4 py-3"><div><h2 className="text-sm font-semibold text-a-text">Paiements à vérifier</h2><p className="mt-0.5 text-xs text-a-text-3">Les décisions se prennent désormais dans une fiche dédiée.</p></div><Link href="/admin/evenementiel/reservations" className="shrink-0 text-xs font-semibold text-a-brand-fg">Voir tous</Link></div>{pendingRequests.length === 0 ? <div className="px-4 py-4 text-sm text-a-text-3">Aucun paiement à vérifier.</div> : <div className="divide-y divide-a-border">{pendingRequests.map((request) => { const summary = request.items.map((item) => `${item.quantity}× ${ticketTypes.find((ticket) => ticket.id === item.ticket_type_id)?.label ?? 'Formule'}`).join(' · '); return <Link key={request.id} href={`/admin/evenementiel/paiements-en-attente/${request.id}`} className="grid gap-3 px-4 py-3 transition-colors hover:bg-a-surface-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><p className="text-sm font-semibold text-a-text">{request.customer_name || request.customer_email} · {request.payment_method_label}</p><p className="mt-0.5 truncate text-xs text-a-text-3">{summary} · {elapsedLabel(request.created_at)}</p></div><div className="flex items-center justify-between gap-3 sm:justify-end"><span className="text-sm font-semibold text-a-text">{formatPrice(request.amount, currency)}</span><span className="text-xs font-semibold text-a-brand-fg">Gérer →</span></div></Link>; })}</div>}</section>

          <section className={cardClass}><div className="flex items-center justify-between border-b border-a-border px-4 py-3"><div><h2 className="text-sm font-semibold text-a-text">Dernières réservations</h2><p className="mt-0.5 text-xs text-a-text-3">Vue rapide des réservations récentes.</p></div><button type="button" onClick={onOpenReservations} className="min-h-9 text-xs font-semibold text-a-brand-fg">Voir toutes</button></div>{reservations.length === 0 ? <div className="px-4 py-4 text-sm text-a-text-3">Aucune réservation pour le moment.</div> : <div className="divide-y divide-a-border">{reservations.slice(0,5).map((reservation) => <div key={reservation.id} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-a-text">{reservation.customer_name}</p><p className="mt-0.5 text-xs text-a-text-3">{reservation.quantity_total} place{reservation.quantity_total > 1 ? 's' : ''} · {formatPrice(reservation.amount_paid, currency)} · {elapsedLabel(reservation.created_at)}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${reservation.status === 'confirmed' ? 'bg-tone-success-bg text-tone-success-fg' : reservation.status === 'refunded' ? 'bg-a-hover text-a-text-2' : 'bg-tone-danger-bg text-tone-danger-fg'}`}>{reservation.status === 'confirmed' ? 'Confirmée' : reservation.status === 'refunded' ? 'Remboursée' : 'Annulée'}</span></div>)}</div>}</section>
        </div>

        <aside className="space-y-4">
          <section className={cardClass}><div className="flex items-center justify-between border-b border-a-border px-4 py-3"><h2 className="text-sm font-semibold text-a-text">Informations</h2><button type="button" onClick={onOpenPage} className="min-h-9 text-xs font-semibold text-a-brand-fg">Modifier</button></div><div className="px-4 py-2 text-sm">{[['Statut', event.status === 'published' ? 'Publié' : event.status === 'draft' ? 'Brouillon' : event.status === 'closed' ? 'Clôturé' : 'Annulé'], ['Date', new Date(event.date_start).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })], ['Lieu', event.location ?? 'Non renseigné'], ['Capacité', `${event.capacity_total} places`], ['Formules', `${activeTickets.length} actives`]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b border-a-border py-2.5 last:border-0"><span className="text-a-text-3">{label}</span><strong className="text-right text-a-text">{value}</strong></div>)}</div></section>
          <EventBookingDeadlineAdminCard event={event} />
          <section className={cardClass}><div className="border-b border-a-border px-4 py-3"><h2 className="text-sm font-semibold text-a-text">Occupation</h2></div><div className="p-4"><p className="text-3xl font-semibold tracking-tight text-a-text">{reservedPlaces} / {event.capacity_total}</p><p className="mt-1 text-xs text-a-text-3">places réservées</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-a-hover"><div className="h-full rounded-full bg-a-brand" style={{ width: `${Math.min(100, occupancy)}%` }} /></div><p className="mt-2 text-xs text-a-text-3">{event.capacity_remaining} places encore disponibles</p>{canManageCapacity && <EventCapacityManager eventId={event.id} capacityTotal={event.capacity_total} capacityRemaining={event.capacity_remaining} />}</div></section>
          <section className={cardClass}><div className="border-b border-a-border px-4 py-3"><h2 className="text-sm font-semibold text-a-text">Actions rapides</h2></div><div className="space-y-2 p-4">{publicEnabled && <Link href={`/evenementiel/evenements/${event.slug}`} target="_blank" rel="noopener noreferrer" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-a-border text-sm font-semibold text-a-text-2 hover:bg-a-surface-2">Voir la page publique <IconExternalLink size={14} /></Link>}<Link href={`/scan?event_id=${encodeURIComponent(event.id)}`} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-a-border text-sm font-semibold text-a-text-2 hover:bg-a-surface-2"><IconScan size={15} /> Scanner les billets</Link>{event.status === 'published' && <button type="button" onClick={onCloseEvent} className="min-h-11 w-full rounded-lg border border-a-border text-sm font-semibold text-a-text-2 hover:bg-a-surface-2">Clôturer l’événement</button>}</div></section>
        </aside>
      </div>
    </div>
  );
}
