'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconBuildingStore, IconCheck, IconMinus, IconPlus, IconTicket, IconX } from '@tabler/icons-react';
import type { EventTicketType } from '@lepefy/types';
import type { AdminEventReservation } from '../page';
import { formatPrice } from '@/lib/utils/format';

type SuccessState = { reservation: AdminEventReservation; ticketUrl: string };

export default function ManualEventReservationModal({
  open,
  eventId,
  ticketTypes,
  currency,
  onClose,
  onCreated,
}: {
  open: boolean;
  eventId: string;
  ticketTypes: EventTicketType[];
  currency: string;
  onClose: () => void;
  onCreated: (reservation: AdminEventReservation) => void;
}) {
  const activeTickets = useMemo(() => ticketTypes.filter((ticket) => ticket.active), [ticketTypes]);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  useEffect(() => {
    if (!open) return;
    setCustomerName('');
    setCustomerEmail('');
    setCustomerPhone('');
    setQuantities({});
    setSubmitting(false);
    setError(null);
    setSuccess(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, submitting, onClose]);

  const totalQuantity = activeTickets.reduce((sum, ticket) => sum + (quantities[ticket.id] ?? 0), 0);
  const totalAmount = activeTickets.reduce((sum, ticket) => sum + Number(ticket.price) * (quantities[ticket.id] ?? 0), 0);

  function adjust(ticketId: string, delta: number) {
    setQuantities((current) => {
      const next = Math.max(0, Math.min(100, (current[ticketId] ?? 0) + delta));
      return { ...current, [ticketId]: next };
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || totalQuantity <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/evenementiel/reservations/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_id: eventId,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          items: activeTickets
            .map((ticket) => ({ ticket_type_id: ticket.id, quantity: quantities[ticket.id] ?? 0 }))
            .filter((item) => item.quantity > 0),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? 'Impossible de créer la réservation.');
        return;
      }
      const created = payload as SuccessState;
      setSuccess(created);
      onCreated(created.reservation);
    } catch {
      setError('Erreur réseau lors de la création de la réservation.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="manual-reservation-title" className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-gray-200 bg-white shadow-2xl sm:max-w-xl sm:rounded-2xl dark:border-gray-700 dark:bg-gray-900">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-100 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-900">
          <div>
            <h2 id="manual-reservation-title" className="text-base font-bold text-gray-950 dark:text-white">Nouvelle réservation</h2>
            <p className="mt-1 text-xs text-gray-500">Paiement encaissé directement en magasin.</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-gray-500 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50 dark:hover:bg-white/5" aria-label="Fermer"><IconX size={18} /></button>
        </div>

        {success ? (
          <div className="p-5">
            <div className="rounded-2xl bg-emerald-50 p-5 text-center dark:bg-emerald-950/35">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300"><IconCheck size={24} /></div>
              <h3 className="mt-3 font-bold text-emerald-950 dark:text-emerald-100">Réservation créée</h3>
              <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">#{success.reservation.id.slice(0, 8).toUpperCase()} · {success.reservation.quantity_total} personne{success.reservation.quantity_total > 1 ? 's' : ''} · {formatPrice(success.reservation.amount_paid, currency)}</p>
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">Le billet est immédiatement valide pour le scan et les impressions.</p>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <a href={success.ticketUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5"><IconTicket size={17} /> Ouvrir le billet</a>
              <button type="button" onClick={onClose} className="min-h-11 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2">Fermer</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5 p-5">
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Client</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">Nom et prénom *<input required value={customerName} onChange={(event) => setCustomerName(event.target.value)} autoComplete="name" className="mt-1 min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal text-gray-950 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-white" /></label>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">E-mail *<input required type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} autoComplete="email" className="mt-1 min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal text-gray-950 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-white" /></label>
              </div>
              <label className="mt-3 block text-xs font-semibold text-gray-700 dark:text-gray-300">Téléphone<input type="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} autoComplete="tel" className="mt-1 min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal text-gray-950 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-white" /></label>
            </section>

            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500">Formules</h3>
              <div className="mt-2 divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
                {activeTickets.length === 0 ? <p className="p-4 text-sm text-gray-500">Aucune formule active.</p> : activeTickets.map((ticket) => {
                  const quantity = quantities[ticket.id] ?? 0;
                  return (
                    <div key={ticket.id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{ticket.label}</p>
                        <p className="mt-0.5 text-xs text-gray-500">{formatPrice(ticket.price, currency)}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => adjust(ticket.id, -1)} disabled={quantity === 0} className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-30 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5" aria-label={`Retirer une ${ticket.label}`}><IconMinus size={16} /></button>
                        <span className="w-8 text-center text-sm font-bold tabular-nums text-gray-950 dark:text-white">{quantity}</span>
                        <button type="button" onClick={() => adjust(ticket.id, 1)} className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5" aria-label={`Ajouter une ${ticket.label}`}><IconPlus size={16} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/25">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200"><IconBuildingStore size={18} /> Paiement effectué en magasin</div>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div><p className="text-xs text-gray-500">{totalQuantity} personne{totalQuantity > 1 ? 's' : ''}</p><p className="mt-0.5 text-xs text-gray-500">Montant recalculé côté serveur</p></div>
                <p className="text-xl font-bold text-gray-950 dark:text-white">{formatPrice(totalAmount, currency)}</p>
              </div>
            </section>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} disabled={submitting} className="min-h-11 rounded-lg border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5">Annuler</button>
              <button type="submit" disabled={submitting || totalQuantity <= 0 || activeTickets.length === 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"><IconCheck size={17} /> {submitting ? 'Création…' : 'Confirmer la réservation'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
