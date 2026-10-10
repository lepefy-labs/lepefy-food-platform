'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconCheck, IconDotsVertical, IconFileSpreadsheet, IconPencil, IconPlus, IconPrinter, IconReceiptRefund, IconSearch, IconSend, IconTicket, IconX } from '@tabler/icons-react';
import Button from '../../../../../_components/ui/Button';
import type { EventReservationStatus, EventTicketType } from '@lepefy/types';
import type { AdminEventReservation } from '../page';
import { formatPrice } from '@/lib/utils/format';
import ManualEventReservationModal from './ManualEventReservationModal';
import ConfirmDialog from '@/app/admin/_components/ui/ConfirmDialog';
import InlineAlert from '@/app/admin/_components/ui/InlineAlert';

const STATUS_LABELS: Record<EventReservationStatus, string> = {
  confirmed: 'Confirmée',
  refunded: 'Remboursée',
  cancelled: 'Annulée',
};

function sourceLabel(reservation: AdminEventReservation) {
  if (reservation.source === 'admin_in_store') return { label: 'En magasin', className: 'bg-tone-info-bg text-tone-info-fg' };
  if (reservation.source === 'external_link' || (!reservation.source && !reservation.stripe_payment_intent_id)) return { label: 'Paiement externe', className: 'bg-tone-warning-bg text-tone-warning-fg' };
  return { label: 'En ligne', className: 'bg-a-brand-soft text-a-brand-fg' };
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
    if (refundTargetId) setOpenActionsId(null);
  }, [refundTargetId]);

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
      <section className="rounded-xl border border-a-border bg-a-surface p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-base font-bold text-a-text">Réservations</h2>
              <span className="text-sm font-semibold text-a-text-3">{confirmed.length} confirmées · {confirmedPeople} personnes</span>
            </div>
            {formulaTotals.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {formulaTotals.map((item) => (
                  <span key={item.id} className="rounded-full bg-a-brand-soft px-2.5 py-1 text-xs font-semibold text-a-brand-fg">{item.quantity} {item.label}</span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <button type="button" onClick={() => setManualOpen(true)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-a-brand px-3 text-xs font-semibold text-a-on-brand transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus focus-visible:ring-offset-2"><IconPlus size={16} /> Ajouter une réservation</button>
            <a href={`${exportBase}/report?${eventQuery}`} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-a-border px-3 text-xs font-semibold text-a-text-2 transition-colors hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus"><IconFileSpreadsheet size={16} /> Rapport détaillé</a>
            <a href={`${exportBase}/print-list?${eventQuery}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-a-border px-3 text-xs font-semibold text-a-text-2 transition-colors hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus"><IconPrinter size={16} /> Liste imprimable</a>
            <a href={`${exportBase}/table-cards?${eventQuery}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-a-border px-3 text-xs font-semibold text-a-text-2 transition-colors hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus"><IconTicket size={16} /> Codes A5</a>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-2.5 rounded-xl border border-a-border bg-a-surface p-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative block w-full min-w-0 lg:w-[420px]">
          <span className="sr-only">Rechercher une réservation</span>
          <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Client, email, référence ou formule" className="min-h-10 w-full rounded-lg border border-a-border bg-a-surface pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-a-focus" />
        </label>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <select value={formulaFilter} onChange={(event) => setFormulaFilter(event.target.value)} className="min-h-10 rounded-lg border border-a-border bg-a-surface px-3 text-xs font-semibold text-a-text-2 focus:outline-none focus:ring-2 focus:ring-a-focus" aria-label="Filtrer par formule">
            <option value="all">Toutes les formules</option>
            {ticketTypes.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.label}</option>)}
          </select>
          <div className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-a-surface-2 p-1" aria-label="Filtrer les réservations par statut">
            {([['all', 'Toutes'], ['confirmed', 'Confirmées'], ['refunded', 'Remboursées'], ['cancelled', 'Annulées']] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => onStatusFilterChange(value)} className={`min-h-9 shrink-0 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus ${statusFilter === value ? 'bg-a-surface text-a-brand-fg shadow-sm' : 'text-a-text-3 hover:text-a-text'}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="rounded-lg bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger-fg">{error}</p>}

      <section className="overflow-visible rounded-xl border border-a-border bg-a-surface">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-a-text-3">Aucune réservation correspondant aux filtres.</div>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(240px,1fr)_minmax(220px,1fr)_105px_110px_150px] gap-3 border-b border-a-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-a-text-3 md:grid">
              <span>Client / référence</span><span>Formules</span><span>Montant</span><span>Statut</span><span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-a-border">
              {filtered.map((reservation) => {
                const reference = reservation.id.slice(0, 8).toUpperCase();
                const source = sourceLabel(reservation);
                return (
                  <div key={reservation.id} className="grid gap-2.5 px-4 py-3 md:grid-cols-[minmax(240px,1fr)_minmax(220px,1fr)_105px_110px_150px] md:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-a-text">{reservation.customer_name}</p>
                        <span className="rounded-md bg-a-hover px-1.5 py-0.5 font-mono text-xs font-bold tracking-wide text-a-text-2">#{reference}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${source.className}`}>{source.label}</span>
                      </div>
                      {editingEmailId === reservation.id ? (
                        <div className="mt-1 flex max-w-md items-center gap-1.5">
                          <input type="email" value={emailDraft} onChange={(event) => onEmailDraftChange(event.target.value)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-a-border px-2 text-xs focus:outline-none focus:ring-2 focus:ring-a-focus" autoFocus />
                          <button type="button" onClick={() => onConfirmEmailEdit(reservation.id)} disabled={resendingId === reservation.id} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-tone-success-fg hover:bg-tone-success-bg disabled:opacity-50" aria-label="Confirmer l’email"><IconCheck size={16} /></button>
                          <button type="button" onClick={onCancelEditEmail} disabled={resendingId === reservation.id} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-a-text-3 hover:bg-a-surface-2 disabled:opacity-50" aria-label="Annuler la modification"><IconX size={16} /></button>
                        </div>
                      ) : (
                        <p className="mt-0.5 max-w-md truncate text-xs text-a-text-3" title={reservation.customer_email}>{reservation.customer_email}{resendFeedbackId === reservation.id && <span className="font-semibold text-tone-success-fg"> · Billet renvoyé</span>}</p>
                      )}
                      <p className="mt-1 text-xs text-a-text-3">{reservation.quantity_total} personne{reservation.quantity_total > 1 ? 's' : ''} · {reservation.quantity_remaining} restante{reservation.quantity_remaining > 1 ? 's' : ''}</p>
                    </div>
                    <div className="space-y-1 text-xs text-a-text-2">
                      {reservation.items.length > 0 ? reservation.items.map((item) => (
                        <div key={item.id} className="flex items-baseline justify-between gap-3 md:justify-start">
                          <span><strong>{item.quantity}×</strong> {item.ticket_type_label}</span>
                          <span className="text-a-text-3 md:hidden">{formatPrice(item.unit_price * item.quantity, currency)}</span>
                        </div>
                      )) : <span className="text-a-text-3">Détail indisponible</span>}
                    </div>
                    <div className="text-sm font-semibold text-a-text">{formatPrice(reservation.amount_paid, currency)}</div>
                    <div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${reservation.status === 'confirmed' ? 'bg-tone-success-bg text-tone-success-fg' : reservation.status === 'refunded' ? 'bg-a-hover text-a-text-2' : 'bg-tone-danger-bg text-tone-danger-fg'}`}>{STATUS_LABELS[reservation.status]}</span></div>
                    <div className="flex min-h-10 items-center gap-1.5 md:justify-end">
                      {reservation.status === 'confirmed' && editingEmailId !== reservation.id ? (
                        <>
                          <Button type="button" variant="ghost" size="sm" onClick={() => onResend(reservation.id)} loading={resendingId === reservation.id} title="Renvoyer le billet"><IconSend size={14} /> Renvoyer</Button>
                          <div className="relative" data-reservation-actions={reservation.id}>
                            <button type="button" onClick={() => setOpenActionsId((current) => current === reservation.id ? null : reservation.id)} aria-haspopup="menu" aria-expanded={openActionsId === reservation.id} aria-label="Plus d’actions" title="Plus d’actions" className="grid min-h-10 min-w-10 place-items-center rounded-lg text-a-text-3 transition-colors hover:bg-a-surface-2 hover:text-a-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus"><IconDotsVertical size={17} aria-hidden="true" /></button>
                            {openActionsId === reservation.id && (
                              <div role="menu" className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-xl border border-a-border bg-a-surface p-1 shadow-lg">
                                <button type="button" role="menuitem" onClick={() => { setOpenActionsId(null); onStartEditEmail(reservation.id, reservation.customer_email); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-medium text-a-text-2 transition-colors hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus"><IconPencil size={14} aria-hidden="true" /> Modifier l’email</button>
                                {reservation.stripe_payment_intent_id && (
                                  <>
                                    <div className="my-1 border-t border-a-border" />
                                    <button type="button" role="menuitem" onClick={() => { setOpenActionsId(null); setRefundTargetId(reservation.id); }} disabled={refundingId === reservation.id} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-medium text-tone-danger-fg transition-colors hover:bg-tone-danger-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tone-danger-solid disabled:opacity-50"><IconReceiptRefund size={14} aria-hidden="true" /> Rembourser la réservation</button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      ) : <span className="text-xs text-a-text-3" aria-label="Aucune action disponible">—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <ManualEventReservationModal open={manualOpen} eventId={eventId} ticketTypes={ticketTypes} currency={currency} onClose={() => setManualOpen(false)} onCreated={onManualCreated} />

      <ConfirmDialog
        open={Boolean(refundTarget)}
        destructive
        title="Rembourser cette réservation ?"
        description={refundTarget && <>Cette action remboursera <strong className="text-a-text">{formatPrice(refundTarget.amount_paid, currency)}</strong> à <strong className="text-a-text">{refundTarget.customer_name}</strong> et libérera <strong className="text-a-text">{refundTarget.quantity_remaining} place{refundTarget.quantity_remaining > 1 ? 's' : ''}</strong>.</>}
        confirmLabel="Confirmer le remboursement"
        loading={refundInProgress}
        error={error}
        onConfirm={() => void confirmRefund()}
        onCancel={() => setRefundTargetId(null)}
      >
        <InlineAlert tone="warning">Vérifiez que le remboursement est bien demandé par le client avant de continuer.</InlineAlert>
      </ConfirmDialog>
    </div>
  );
}
