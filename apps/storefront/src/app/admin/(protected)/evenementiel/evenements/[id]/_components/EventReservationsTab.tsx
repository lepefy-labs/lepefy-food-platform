'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconAlertTriangle, IconCheck, IconDotsVertical, IconFileSpreadsheet, IconPencil, IconPlus, IconPrinter, IconReceiptRefund, IconSearch, IconSend, IconTicket, IconX } from '@tabler/icons-react';
import Button from '../../../../../_components/ui/Button';
import type { EventReservationStatus, EventTicketType } from '@lepefy/types';
import type { AdminEventReservation } from '../page';
import { formatPrice } from '@/lib/utils/format';
import ManualEventReservationModal from './ManualEventReservationModal';

const STATUS_LABELS: Record<EventReservationStatus, string> = {
  confirmed: 'Confirmée',
  refunded: 'Remboursée',
  cancelled: 'Annulée',
};

function sourceLabel(reservation: AdminEventReservation) {
  if (reservation.source === 'admin_in_store') return { label: 'En magasin', className: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300' };
  if (reservation.source === 'external_link' || (!reservation.source && !reservation.stripe_payment_intent_id)) return { label: 'Paiement externe', className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' };
  return { label: 'En ligne', className: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' };
}

export default function EventReservationsTab({
  eventId,
  reservations,
  ticketTypes,
  currency,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  editingEmailId,
  emailDraft,
  onEmailDraftChange,
  onStartEditEmail,
  onCancelEditEmail,
  onConfirmEmailEdit,
  onResend,
  onRefund,
  resendingId,
  refundingId,
  resendFeedbackId,
  error,
}: {
  eventId: string;
  reservations: AdminEventReservation[];
  ticketTypes: EventTicketType[];
  currency: string;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: 'all' | EventReservationStatus;
  onStatusFilterChange: (value: 'all' | EventReservationStatus) => void;
  editingEmailId: string | null;
  emailDraft: string;
  onEmailDraftChange: (value: string) => void;
  onStartEditEmail: (id: string, email: string) => void;
  onCancelEditEmail: () => void;
  onConfirmEmailEdit: (id: string) => void;
  onResend: (id: string) => void;
  onRefund: (id: string) => Promise<boolean>;
  resendingId: string | null;
  refundingId: string | null;
  resendFeedbackId: string | null;
  error: string | null;
}) {
  const [refundTargetId, setRefundTargetId] = useState<string | null>(null);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const [formulaFilter, setFormulaFilter] = useState('all');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualReservations, setManualReservations] = useState<AdminEventReservation[]>([]);
  const cancelRefundRef = useRef<HTMLButtonElement>(null);

  const allReservations = useMemo(() => {
    const existingIds = new Set(reservations.map((reservation) => reservation.id));
    return [...manualReservations.filter((reservation) => !existingIds.has(reservation.id)), ...reservations];
  }, [manualReservations, reservations]);

  const filtered = allReservations.filter((reservation) => {
    const haystack = `${reservation.customer_name} ${reservation.customer_email} ${reservation.id.slice(0, 8)} ${reservation.items.map((item) => item.ticket_type_label).join(' ')}`.toLowerCase();
    const matchesSearch = !search.trim() || haystack.includes(search.trim().toLowerCase());
    const matchesStatus = statusFilter === 'all' || reservation.status === statusFilter;
    const matchesFormula = formulaFilter === 'all' || reservation.items.some((item) => item.ticket_type_id === formulaFilter);
    return matchesSearch && matchesStatus && matchesFormula;
  });

  const confirmed = allReservations.filter((reservation) => reservation.status === 'confirmed');
  const confirmedPeople = confirmed.reduce((sum, reservation) => sum + reservation.quantity_total, 0);
  const formulaTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const reservation of confirmed) {
      for (const item of reservation.items) {
        totals.set(item.ticket_type_id, (totals.get(item.ticket_type_id) ?? 0) + item.quantity);
      }
    }
    return ticketTypes
      .map((ticket) => ({ id: ticket.id, label: ticket.label, quantity: totals.get(ticket.id) ?? 0 }))
      .filter((item) => item.quantity > 0);
  }, [confirmed, ticketTypes]);

  const refundTarget = refundTargetId ? allReservations.find((reservation) => reservation.id === refundTargetId) ?? null : null;
  const refundInProgress = Boolean(refundTarget && refundingId === refundTarget.id);

  useEffect(() => {
    if (!openActionsId) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(`[data-reservation-actions="${openActionsId}"]`)) setOpenActionsId(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenActionsId(null);
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [openActionsId]);

  useEffect(() => {
    if (!refundTargetId) return;
    setOpenActionsId(null);
    cancelRefundRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !refundInProgress) setRefundTargetId(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [refundTargetId, refundInProgress]);

  async function confirmRefund() {
    if (!refundTarget || refundInProgress) return;
    const success = await onRefund(refundTarget.id);
    if (success) setRefundTargetId(null);
  }

  function onManualCreated(reservation: AdminEventReservation) {
    setManualReservations((current) => [reservation, ...current.filter((item) => item.id !== reservation.id)]);
  }

  const exportBase = `/api/admin/evenementiel/reservations`;
  const eventQuery = `event_id=${encodeURIComponent(eventId)}`;

  return (
    <div className="mt-4 space-y-3">
      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-base font-bold text-gray-950 dark:text-white">Réservations</h2>
              <span className="text-sm font-semibold text-gray-500">{confirmed.length} confirmées · {confirmedPeople} personnes</span>
            </div>
            {formulaTotals.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {formulaTotals.map((item) => (
                  <span key={item.id} className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">{item.quantity} {item.label}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <button type="button" onClick={() => setManualOpen(true)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"><IconPlus size={16} /> Ajouter une réservation</button>
            <a href={`${exportBase}/report?${eventQuery}`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"><IconFileSpreadsheet size={16} /> Rapport détaillé</a>
            <a href={`${exportBase}/print-list?${eventQuery}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"><IconPrinter size={16} /> Liste imprimable</a>
            <a href={`${exportBase}/table-cards?${eventQuery}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"><IconTicket size={16} /> Codes A5</a>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-2.5 rounded-xl border border-gray-200 bg-white p-3 lg:flex-row lg:items-center lg:justify-between dark:border-gray-800 dark:bg-gray-900">
        <label className="relative block w-full min-w-0 lg:w-[420px]">
          <span className="sr-only">Rechercher une réservation</span>
          <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Client, email, référence ou formule" className="min-h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
        </label>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <select value={formulaFilter} onChange={(event) => setFormulaFilter(event.target.value)} className="min-h-10 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200" aria-label="Filtrer par formule">
            <option value="all">Toutes les formules</option>
            {ticketTypes.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.label}</option>)}
          </select>
          <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-gray-50 p-1 dark:bg-gray-950" aria-label="Filtrer les réservations par statut">
            {([['all', 'Toutes'], ['confirmed', 'Confirmées'], ['refunded', 'Remboursées'], ['cancelled', 'Annulées']] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => onStatusFilterChange(value)} className={`min-h-9 shrink-0 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${statusFilter === value ? 'bg-white text-[var(--color-primary-dark)] shadow-sm dark:bg-gray-800 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      <section className="overflow-visible rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">Aucune réservation correspondant aux filtres.</div>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(240px,1fr)_minmax(220px,1fr)_105px_110px_150px] gap-3 border-b border-gray-100 px-4 py-2 text-2xs font-semibold uppercase tracking-wide text-gray-400 md:grid dark:border-gray-800">
              <span>Client / référence</span><span>Formules</span><span>Montant</span><span>Statut</span><span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtered.map((reservation) => {
                const reference = reservation.id.slice(0, 8).toUpperCase();
                const source = sourceLabel(reservation);
                return (
                  <div key={reservation.id} className="grid gap-2.5 px-4 py-3 md:grid-cols-[minmax(240px,1fr)_minmax(220px,1fr)_105px_110px_150px] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{reservation.customer_name}</p>
                        <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-mono text-2xs font-bold tracking-wide text-gray-600 dark:bg-gray-800 dark:text-gray-300">#{reference}</span>
                        <span className={`rounded-full px-2 py-0.5 text-2xs font-semibold ${source.className}`}>{source.label}</span>
                      </div>
                      {editingEmailId === reservation.id ? (
                        <div className="mt-1 flex max-w-md items-center gap-1.5">
                          <input type="email" value={emailDraft} onChange={(event) => onEmailDraftChange(event.target.value)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-gray-200 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950" autoFocus />
                          <button type="button" onClick={() => onConfirmEmailEdit(reservation.id)} disabled={resendingId === reservation.id} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50" aria-label="Confirmer l’email"><IconCheck size={16} /></button>
                          <button type="button" onClick={onCancelEditEmail} disabled={resendingId === reservation.id} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-50" aria-label="Annuler la modification"><IconX size={16} /></button>
                        </div>
                      ) : (
                        <p className="mt-0.5 max-w-md truncate text-xs text-gray-500 dark:text-gray-400" title={reservation.customer_email}>{reservation.customer_email}{resendFeedbackId === reservation.id && <span className="font-semibold text-emerald-600"> · Billet renvoyé</span>}</p>
                      )}
                      <p className="mt-1 text-xs text-gray-400">{reservation.quantity_total} personne{reservation.quantity_total > 1 ? 's' : ''} · {reservation.quantity_remaining} restante{reservation.quantity_remaining > 1 ? 's' : ''}</p>
                    </div>
                    <div className="space-y-1 text-xs text-gray-700 dark:text-gray-300">
                      {reservation.items.length > 0 ? reservation.items.map((item) => (
                        <div key={item.id} className="flex items-baseline justify-between gap-3 md:justify-start">
                          <span><strong>{item.quantity}×</strong> {item.ticket_type_label}</span>
                          <span className="text-gray-400 md:hidden">{formatPrice(item.unit_price * item.quantity, currency)}</span>
                        </div>
                      )) : <span className="text-gray-400">Détail indisponible</span>}
                    </div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatPrice(reservation.amount_paid, currency)}</div>
                    <div><span className={`rounded-full px-2 py-1 text-2xs font-semibold ${reservation.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : reservation.status === 'refunded' ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>{STATUS_LABELS[reservation.status]}</span></div>
                    <div className="flex min-h-10 items-center gap-1.5 md:justify-end">
                      {reservation.status === 'confirmed' && editingEmailId !== reservation.id ? (
                        <>
                          <Button type="button" variant="ghost" size="sm" onClick={() => onResend(reservation.id)} loading={resendingId === reservation.id} title="Renvoyer le billet"><IconSend size={14} /> Renvoyer</Button>
                          <div className="relative" data-reservation-actions={reservation.id}>
                            <button type="button" onClick={() => setOpenActionsId((current) => current === reservation.id ? null : reservation.id)} aria-haspopup="menu" aria-expanded={openActionsId === reservation.id} aria-label="Plus d’actions" title="Plus d’actions" className="grid min-h-10 min-w-10 place-items-center rounded-lg text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"><IconDotsVertical size={17} aria-hidden="true" /></button>
                            {openActionsId === reservation.id && (
                              <div role="menu" className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
                                <button type="button" role="menuitem" onClick={() => { setOpenActionsId(null); onStartEditEmail(reservation.id, reservation.customer_email); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:text-gray-200 dark:hover:bg-white/5"><IconPencil size={14} aria-hidden="true" /> Modifier l’email</button>
                                {reservation.stripe_payment_intent_id && (
                                  <>
                                    <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                                    <button type="button" role="menuitem" onClick={() => { setOpenActionsId(null); setRefundTargetId(reservation.id); }} disabled={refundingId === reservation.id} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"><IconReceiptRefund size={14} aria-hidden="true" /> Rembourser la réservation</button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      ) : <span className="text-xs text-gray-300 dark:text-gray-600" aria-label="Aucune action disponible">—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <ManualEventReservationModal open={manualOpen} eventId={eventId} ticketTypes={ticketTypes} currency={currency} onClose={() => setManualOpen(false)} onCreated={onManualCreated} />

      {refundTarget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !refundInProgress) setRefundTargetId(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="refund-dialog-title" aria-describedby="refund-dialog-description" className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400"><IconAlertTriangle size={20} aria-hidden="true" /></div>
              <div className="min-w-0 flex-1">
                <h2 id="refund-dialog-title" className="text-base font-semibold text-gray-950 dark:text-white">Rembourser cette réservation ?</h2>
                <p id="refund-dialog-description" className="mt-1.5 text-sm leading-5 text-gray-600 dark:text-gray-300">Cette action remboursera <strong className="text-gray-900 dark:text-white">{formatPrice(refundTarget.amount_paid, currency)}</strong> à <strong className="text-gray-900 dark:text-white">{refundTarget.customer_name}</strong> et libérera <strong className="text-gray-900 dark:text-white">{refundTarget.quantity_remaining} place{refundTarget.quantity_remaining > 1 ? 's' : ''}</strong>.</p>
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Vérifiez que le remboursement est bien demandé par le client avant de continuer.</p>
                {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button ref={cancelRefundRef} type="button" onClick={() => setRefundTargetId(null)} disabled={refundInProgress} className="min-h-11 rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/5">Annuler</button>
              <button type="button" onClick={confirmRefund} disabled={refundInProgress} className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:ring-offset-gray-900">{refundInProgress ? 'Remboursement…' : 'Confirmer le remboursement'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
