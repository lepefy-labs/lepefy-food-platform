'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconBuildingStore, IconCheck, IconMinus, IconPlus, IconTicket } from '@tabler/icons-react';
import type { EventTicketType } from '@lepefy/types';
import type { AdminEventReservation } from '../page';
import { formatPrice } from '@/lib/utils/format';
import Dialog from '@/app/admin/_components/ui/Dialog';

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
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!submitting}
      title="Nouvelle réservation"
      description="Paiement encaissé directement en magasin."
    >
        {success ? (
          <div>
            <div className="rounded-2xl bg-tone-success-bg p-5 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-tone-success-bg text-tone-success-fg"><IconCheck size={24} /></div>
              <h3 className="mt-3 font-bold text-tone-success-fg">Réservation créée</h3>
              <p className="mt-1 text-sm text-tone-success-fg">#{success.reservation.id.slice(0, 8).toUpperCase()} · {success.reservation.quantity_total} personne{success.reservation.quantity_total > 1 ? 's' : ''} · {formatPrice(success.reservation.amount_paid, currency)}</p>
              <p className="mt-2 text-xs text-tone-success-fg">Le billet est immédiatement valide pour le scan et les impressions.</p>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <a href={success.ticketUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-a-border px-4 text-sm font-semibold text-a-text-2 hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus"><IconTicket size={17} /> Ouvrir le billet</a>
              <button type="button" onClick={onClose} className="min-h-11 rounded-lg bg-a-brand px-4 text-sm font-semibold text-a-on-brand hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus focus-visible:ring-offset-2">Fermer</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-a-text-3">Client</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-a-text-2">Nom et prénom *<input required value={customerName} onChange={(event) => setCustomerName(event.target.value)} autoComplete="name" className="mt-1 min-h-11 w-full rounded-lg border border-a-border bg-a-surface px-3 text-sm font-normal text-a-text focus:outline-none focus:ring-2 focus:ring-a-focus" /></label>
                <label className="text-xs font-semibold text-a-text-2">E-mail *<input required type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} autoComplete="email" className="mt-1 min-h-11 w-full rounded-lg border border-a-border bg-a-surface px-3 text-sm font-normal text-a-text focus:outline-none focus:ring-2 focus:ring-a-focus" /></label>
              </div>
              <label className="mt-3 block text-xs font-semibold text-a-text-2">Téléphone<input type="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} autoComplete="tel" className="mt-1 min-h-11 w-full rounded-lg border border-a-border bg-a-surface px-3 text-sm font-normal text-a-text focus:outline-none focus:ring-2 focus:ring-a-focus" /></label>
            </section>

            <section>
              <h3 className="text-xs font-bold uppercase tracking-wide text-a-text-3">Formules</h3>
              <div className="mt-2 divide-y divide-a-border overflow-hidden rounded-xl border border-a-border">
                {activeTickets.length === 0 ? <p className="p-4 text-sm text-a-text-3">Aucune formule active.</p> : activeTickets.map((ticket) => {
                  const quantity = quantities[ticket.id] ?? 0;
                  return (
                    <div key={ticket.id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-a-text">{ticket.label}</p>
                        <p className="mt-0.5 text-xs text-a-text-3">{formatPrice(ticket.price, currency)}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => adjust(ticket.id, -1)} disabled={quantity === 0} className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-a-border text-a-text-2 hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus disabled:opacity-30" aria-label={`Retirer une ${ticket.label}`}><IconMinus size={16} /></button>
                        <span className="w-8 text-center text-sm font-bold tabular-nums text-a-text">{quantity}</span>
                        <button type="button" onClick={() => adjust(ticket.id, 1)} className="grid min-h-10 min-w-10 place-items-center rounded-lg border border-a-border text-a-text-2 hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus" aria-label={`Ajouter une ${ticket.label}`}><IconPlus size={16} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-tone-success-border bg-tone-success-bg p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-tone-success-fg"><IconBuildingStore size={18} /> Paiement effectué en magasin</div>
              <div className="mt-3 flex items-end justify-between gap-4">
                <div><p className="text-xs text-a-text-3">{totalQuantity} personne{totalQuantity > 1 ? 's' : ''}</p><p className="mt-0.5 text-xs text-a-text-3">Montant recalculé côté serveur</p></div>
                <p className="text-xl font-bold text-a-text">{formatPrice(totalAmount, currency)}</p>
              </div>
            </section>

            {error && <p className="rounded-lg bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger-fg">{error}</p>}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} disabled={submitting} className="min-h-11 rounded-lg border border-a-border px-4 text-sm font-semibold text-a-text-2 hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus disabled:opacity-50">Annuler</button>
              <button type="submit" disabled={submitting || totalQuantity <= 0 || activeTickets.length === 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-a-brand px-4 text-sm font-semibold text-a-on-brand hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"><IconCheck size={17} /> {submitting ? 'Création…' : 'Confirmer la réservation'}</button>
            </div>
          </form>
        )}
    </Dialog>
  );
}
