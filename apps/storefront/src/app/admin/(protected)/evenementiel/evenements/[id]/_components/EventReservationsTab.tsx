'use client';

import { IconCheck, IconPencil, IconReceiptRefund, IconSearch, IconSend, IconX } from '@tabler/icons-react';
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
    <div className="mt-5 space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800 dark:bg-gray-900">
        <label className="relative block min-w-0 flex-1 sm:max-w-md">
          <span className="sr-only">Rechercher une réservation</span>
          <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Rechercher un client ou un email" className="min-h-11 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />
        </label>
        <div className="flex gap-1 overflow-x-auto" aria-label="Filtrer les réservations par statut">
          {([
            ['all', 'Toutes'],
            ['confirmed', 'Confirmées'],
            ['refunded', 'Remboursées'],
            ['cancelled', 'Annulées'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => onStatusFilterChange(value)} className={`min-h-10 shrink-0 rounded-lg px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${statusFilter === value ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]' : 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/5'}`}>{label}</button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">Aucune réservation pour cet événement.</div>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(120px,.7fr)_100px_100px_minmax(190px,auto)] gap-3 border-b border-gray-100 px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-gray-400 md:grid dark:border-gray-800">
              <span>Client</span><span>Billets / places</span><span>Montant</span><span>Statut</span><span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtered.map((reservation) => (
                <div key={reservation.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(120px,.7fr)_100px_100px_minmax(190px,auto)] md:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{reservation.customer_name}</p>
                    {editingEmailId === reservation.id ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <input type="email" value={emailDraft} onChange={(e) => onEmailDraftChange(e.target.value)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-gray-200 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950" autoFocus />
                        <button type="button" onClick={() => onConfirmEmailEdit(reservation.id)} disabled={resendingId === reservation.id} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-emerald-600 hover:bg-emerald-50 disabled:opacity-50" aria-label="Confirmer l’email"><IconCheck size={16} /></button>
                        <button type="button" onClick={onCancelEditEmail} disabled={resendingId === reservation.id} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-50" aria-label="Annuler la modification"><IconX size={16} /></button>
                      </div>
                    ) : (
                      <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{reservation.customer_email}{resendFeedbackId === reservation.id && <span className="font-semibold text-emerald-600"> · Billet renvoyé</span>}</p>
                    )}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-300"><span className="md:hidden text-gray-400">Places · </span>{reservation.quantity_remaining} / {reservation.quantity_total} restantes</div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{formatPrice(reservation.amount_paid, currency)}</div>
                  <div><span className={`rounded-full px-2 py-1 text-2xs font-semibold ${reservation.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : reservation.status === 'refunded' ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'}`}>{STATUS_LABELS[reservation.status]}</span></div>
                  <div className="flex flex-wrap gap-1.5 md:justify-end">
                    {reservation.status === 'confirmed' && editingEmailId !== reservation.id && (
                      <>
                        <Button type="button" variant="ghost" size="sm" onClick={() => onResend(reservation.id)} loading={resendingId === reservation.id} title="Renvoyer le billet"><IconSend size={14} /> Renvoyer</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => onStartEditEmail(reservation.id, reservation.customer_email)} title="Modifier l’email"><IconPencil size={14} /> Email</Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => onRefund(reservation.id)} loading={refundingId === reservation.id} title="Rembourser"><IconReceiptRefund size={14} /> Rembourser</Button>
                      </>
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
