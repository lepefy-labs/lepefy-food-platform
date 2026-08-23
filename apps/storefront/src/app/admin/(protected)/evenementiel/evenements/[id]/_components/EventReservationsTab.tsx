'use client';

import { IconCheck, IconDotsVertical, IconPencil, IconReceiptRefund, IconSearch, IconSend, IconX } from '@tabler/icons-react';
import Button from '../../../../../_components/ui/Button';
import type { EventReservation, EventReservationStatus } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';

const STATUS_LABELS: Record<EventReservationStatus, string> = {
  confirmed: 'Confirmée',
  refunded: 'Remboursée',
  cancelled: 'Annulée',
};

export default function EventReservationsTab({
  reservations,
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
  reservations: EventReservation[];
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
  onRefund: (id: string) => void;
  resendingId: string | null;
  refundingId: string | null;
  resendFeedbackId: string | null;
  error: string | null;
}) {
  const filtered = reservations.filter((reservation) => {
    const matchesSearch = !search.trim() || `${reservation.customer_name} ${reservation.customer_email}`.toLowerCase().includes(search.trim().toLowerCase());
    const matchesStatus = statusFilter === 'all' || reservation.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-col gap-2.5 rounded-xl border border-gray-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800 dark:bg-gray-900">
        <label className="relative block w-full min-w-0 sm:w-[420px] sm:max-w-[48%]">
          <span className="sr-only">Rechercher une réservation</span>
          <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Rechercher un client ou un email"
            className="min-h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          />
        </label>
        <div className="inline-flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg bg-gray-50 p-1 dark:bg-gray-950" aria-label="Filtrer les réservations par statut">
          {([
            ['all', 'Toutes'],
            ['confirmed', 'Confirmées'],
            ['refunded', 'Remboursées'],
            ['cancelled', 'Annulées'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onStatusFilterChange(value)}
              className={`min-h-9 shrink-0 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                statusFilter === value
                  ? 'bg-white text-[var(--color-primary-dark)] shadow-sm dark:bg-gray-800 dark:text-white'
                  : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      <section className="overflow-visible rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {filtered.length === 0 ? (
          <div className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">Aucune réservation pour cet événement.</div>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(260px,1fr)_170px_120px_120px_160px] gap-3 border-b border-gray-100 px-4 py-2 text-2xs font-semibold uppercase tracking-wide text-gray-400 md:grid dark:border-gray-800">
              <span>Client</span><span>Billets / places</span><span>Montant</span><span>Statut</span><span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtered.map((reservation) => (
                <div key={reservation.id} className="grid gap-2.5 px-4 py-2.5 md:grid-cols-[minmax(260px,1fr)_170px_120px_120px_160px] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{reservation.customer_name}</p>
                    {editingEmailId === reservation.id ? (
                      <div className="mt-1 flex max-w-md items-center gap-1.5">
                        <input type="email" value={emailDraft} onChange={(e) => onEmailDraftChange(e.target.value)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-gray-200 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950" autoFocus />
                        <button type="button" onClick={() => onConfirmEmailEdit(reservation.id)} disabled={resendingId === reservation.id} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50" aria-label="Confirmer l’email"><IconCheck size={16} /></button>
                        <button type="button" onClick={onCancelEditEmail} disabled={resendingId === reservation.id} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-50" aria-label="Annuler la modification"><IconX size={16} /></button>
                      </div>
                    ) : (
                      <p className="mt-0.5 max-w-md truncate text-xs text-gray-500 dark:text-gray-400" title={reservation.customer_email}>
                        {reservation.customer_email}
                        {resendFeedbackId === reservation.id && <span className="font-semibold text-emerald-600"> · Billet renvoyé</span>}
                      </p>
                    )}
                  </div>

                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    <span className="md:hidden text-gray-400">Places · </span>{reservation.quantity_remaining} / {reservation.quantity_total} restantes
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatPrice(reservation.amount_paid, currency)}</div>
                  <div>
                    <span className={`rounded-full px-2 py-1 text-2xs font-semibold ${reservation.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : reservation.status === 'refunded' ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>{STATUS_LABELS[reservation.status]}</span>
                  </div>

                  <div className="flex min-h-10 items-center gap-1.5 md:justify-end">
                    {reservation.status === 'confirmed' && editingEmailId !== reservation.id ? (
                      <>
                        <Button type="button" variant="ghost" size="sm" onClick={() => onResend(reservation.id)} loading={resendingId === reservation.id} title="Renvoyer le billet">
                          <IconSend size={14} /> Renvoyer
                        </Button>

                        <details className="relative">
                          <summary className="grid min-h-10 min-w-10 cursor-pointer list-none place-items-center rounded-lg text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200" aria-label="Plus d’actions" title="Plus d’actions">
                            <IconDotsVertical size={17} aria-hidden="true" />
                          </summary>
                          <div className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900">
                            <button
                              type="button"
                              onClick={() => onStartEditEmail(reservation.id, reservation.customer_email)}
                              className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:text-gray-200 dark:hover:bg-white/5"
                            >
                              <IconPencil size={14} aria-hidden="true" /> Modifier l’email
                            </button>
                            <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                            <button
                              type="button"
                              onClick={() => onRefund(reservation.id)}
                              disabled={refundingId === reservation.id}
                              className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
                            >
                              <IconReceiptRefund size={14} aria-hidden="true" />
                              {refundingId === reservation.id ? 'Remboursement…' : 'Rembourser la réservation'}
                            </button>
                          </div>
                        </details>
                      </>
                    ) : (
                      <span className="text-xs text-gray-300 dark:text-gray-600" aria-label="Aucune action disponible">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
