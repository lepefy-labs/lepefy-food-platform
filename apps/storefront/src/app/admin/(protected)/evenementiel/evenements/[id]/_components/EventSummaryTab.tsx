'use client';

import Link from 'next/link';
import { IconCheck, IconExternalLink, IconScan, IconAlertTriangle } from '@tabler/icons-react';
import type { EventReservation, EventReservationRequest, EventRow, EventTicketType } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';

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
  onOpenReservations,
  onOpenPage,
  onCloseEvent,
}: {
  event: EventRow;
  ticketTypes: EventTicketType[];
  reservations: EventReservation[];
  pendingRequests: EventReservationRequest[];
  currency: string;
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

  const metricClass = 'rounded-xl border border-gray-200 bg-white p-3.5 dark:border-gray-800 dark:bg-gray-900';
  const cardClass = 'overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900';

  return (
    <div className="mt-5 space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={metricClass}><p className="text-xs text-gray-500 dark:text-gray-400">Réservations</p><p className="mt-1 text-2xl font-semibold text-gray-950 dark:text-white">{confirmedReservations.length}</p><p className="mt-1 text-2xs text-gray-400">{reservedPlaces} places réservées</p></div>
        <div className={metricClass}><p className="text-xs text-gray-500 dark:text-gray-400">Occupation</p><p className="mt-1 text-2xl font-semibold text-gray-950 dark:text-white">{occupancy}%</p><p className="mt-1 text-2xs text-gray-400">{event.capacity_remaining} places restantes</p></div>
        <div className={metricClass}><p className="text-xs text-gray-500 dark:text-gray-400">Chiffre d’affaires</p><p className="mt-1 text-2xl font-semibold text-gray-950 dark:text-white">{formatPrice(revenue, currency)}</p><p className="mt-1 text-2xs text-gray-400">réservations confirmées</p></div>
        <div className={`${metricClass} ${pendingRequests.length > 0 ? 'border-amber-200 dark:border-amber-900/70' : ''}`}><p className="text-xs text-gray-500 dark:text-gray-400">Paiements à vérifier</p><p className="mt-1 text-2xl font-semibold text-gray-950 dark:text-white">{pendingRequests.length}</p><p className="mt-1 text-2xs text-gray-400">{pendingRequests.length > 0 ? `${formatPrice(pendingAmount, currency)} en attente` : 'Aucun paiement en attente'}</p></div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,.8fr)]">
        <div className="space-y-4">
          <section className={cardClass}>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
              <div><h2 className="text-sm font-semibold text-gray-950 dark:text-white">Prêt à publier</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Checklist dérivée des données de l’événement.</p></div>
              <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{readinessDone} / {readiness.length}</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {readiness.map((item) => (
                <div key={item.label} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 py-2.5">
                  <span className={`grid h-5 w-5 place-items-center rounded-full ${item.ok ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : item.required ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'}`}>{item.ok ? <IconCheck size={12} /> : <IconAlertTriangle size={12} />}</span>
                  <div><p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.label}</p><p className="text-2xs text-gray-400">{item.meta}</p></div>
                  {!item.ok && !item.required && <button type="button" onClick={onOpenPage} className="min-h-9 text-xs font-semibold text-[var(--color-primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">Compléter</button>}
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 px-4 py-3 dark:border-gray-800"><div className="mb-1.5 flex justify-between text-xs text-gray-500"><span>Configuration</span><strong>{Math.round((readinessDone / readiness.length) * 100)}%</strong></div><div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"><div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${Math.round((readinessDone / readiness.length) * 100)}%` }} /></div></div>
          </section>

          <section className={cardClass}>
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
              <div><h2 className="text-sm font-semibold text-gray-950 dark:text-white">Paiements à vérifier</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Les décisions se prennent désormais dans une fiche dédiée.</p></div>
              <Link href="/admin/evenementiel/reservations" className="shrink-0 text-xs font-semibold text-violet-700 dark:text-violet-300">Voir tous</Link>
            </div>
            {pendingRequests.length === 0 ? <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">Aucun paiement à vérifier.</div> : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">{pendingRequests.map((request) => {
                const summary = request.items.map((item) => `${item.quantity}× ${ticketTypes.find((ticket) => ticket.id === item.ticket_type_id)?.label ?? 'Formule'}`).join(' · ');
                return <Link key={request.id} href={`/admin/evenementiel/paiements-en-attente/${request.id}`} className="grid gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-white/5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{request.customer_name || request.customer_email} · {request.payment_method_label}</p><p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{summary} · {elapsedLabel(request.created_at)}</p></div><div className="flex items-center justify-between gap-3 sm:justify-end"><span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatPrice(request.amount, currency)}</span><span className="text-xs font-semibold text-violet-700 dark:text-violet-300">Gérer →</span></div></Link>;
              })}</div>
            )}
          </section>

          <section className={cardClass}>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800"><div><h2 className="text-sm font-semibold text-gray-950 dark:text-white">Dernières réservations</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Vue rapide des réservations récentes.</p></div><button type="button" onClick={onOpenReservations} className="min-h-9 text-xs font-semibold text-[var(--color-primary-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">Voir toutes</button></div>
            {reservations.length === 0 ? <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400">Aucune réservation pour le moment.</div> : <div className="divide-y divide-gray-100 dark:divide-gray-800">{reservations.slice(0, 5).map((reservation) => <div key={reservation.id} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{reservation.customer_name}</p><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{reservation.quantity_total} place{reservation.quantity_total > 1 ? 's' : ''} · {formatPrice(reservation.amount_paid, currency)} · {elapsedLabel(reservation.created_at)}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-2xs font-semibold ${reservation.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : reservation.status === 'refunded' ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>{reservation.status === 'confirmed' ? 'Confirmée' : reservation.status === 'refunded' ? 'Remboursée' : 'Annulée'}</span></div>)}</div>}
          </section>
        </div>

        <aside className="space-y-4">
          <section className={cardClass}><div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800"><h2 className="text-sm font-semibold text-gray-950 dark:text-white">Informations</h2><button type="button" onClick={onOpenPage} className="min-h-9 text-xs font-semibold text-[var(--color-primary-dark)]">Modifier</button></div><div className="px-4 py-2 text-sm">{[['Statut', event.status === 'published' ? 'Publié' : event.status === 'draft' ? 'Brouillon' : event.status === 'closed' ? 'Clôturé' : 'Annulé'], ['Date', new Date(event.date_start).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })], ['Lieu', event.location ?? 'Non renseigné'], ['Capacité', `${event.capacity_total} places`], ['Formules', `${activeTickets.length} actives`]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b border-gray-100 py-2.5 last:border-0 dark:border-gray-800"><span className="text-gray-500 dark:text-gray-400">{label}</span><strong className="text-right text-gray-900 dark:text-gray-100">{value}</strong></div>)}</div></section>
          <section className={cardClass}><div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800"><h2 className="text-sm font-semibold text-gray-950 dark:text-white">Occupation</h2></div><div className="p-4"><p className="text-3xl font-semibold tracking-tight text-gray-950 dark:text-white">{reservedPlaces} / {event.capacity_total}</p><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">places réservées</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"><div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${Math.min(100, occupancy)}%` }} /></div><p className="mt-2 text-2xs text-gray-400">{event.capacity_remaining} places encore disponibles</p></div></section>
          <section className={cardClass}><div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800"><h2 className="text-sm font-semibold text-gray-950 dark:text-white">Actions rapides</h2></div><div className="space-y-2 p-4">{publicEnabled && <Link href={`/evenementiel/evenements/${event.slug}`} target="_blank" rel="noopener noreferrer" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5">Voir la page publique <IconExternalLink size={14} /></Link>}<Link href={`/scan?event_id=${encodeURIComponent(event.id)}`} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"><IconScan size={15} /> Scanner les billets</Link>{event.status === 'published' && <button type="button" onClick={onCloseEvent} className="min-h-11 w-full rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5">Clôturer l’événement</button>}</div></section>
        </aside>
      </div>
    </div>
  );
}
