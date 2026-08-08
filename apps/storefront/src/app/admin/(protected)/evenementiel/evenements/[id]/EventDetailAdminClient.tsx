'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IconArrowLeft, IconPlus, IconTrash, IconReceiptRefund } from '@tabler/icons-react';
import { formatDate, formatPrice } from '@/lib/utils/format';
import type { EventRow, EventTicketType, EventReservation, EventStatus, EventReservationStatus } from '@lepefy/types';

const STATUS_OPTIONS: EventStatus[] = ['draft', 'published', 'closed', 'cancelled'];

const RESERVATION_STATUS_LABELS: Record<EventReservationStatus, string> = {
  confirmed: 'Confirmée',
  cancelled: 'Annulée',
  refunded: 'Remboursée',
};

interface Props {
  event: EventRow;
  initialTicketTypes: EventTicketType[];
  initialReservations: EventReservation[];
  currency: string;
}

export default function EventDetailAdminClient({ event: initialEvent, initialTicketTypes, initialReservations, currency }: Props) {
  const [event, setEvent] = useState(initialEvent);
  const [ticketTypes, setTicketTypes] = useState(initialTicketTypes);
  const [reservations, setReservations] = useState(initialReservations);
  const [savingStatus, setSavingStatus] = useState(false);

  const [newLabel, setNewLabel] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [addingTicket, setAddingTicket] = useState(false);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inputClass = 'border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  async function updateStatus(status: EventStatus) {
    setSavingStatus(true);
    try {
      const res = await fetch(`/api/admin/evenementiel/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result = await res.json();
      if (res.ok) setEvent(result);
    } finally {
      setSavingStatus(false);
    }
  }

  async function addTicketType(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const price = Number(newPrice);
    if (!newLabel.trim() || !Number.isFinite(price) || price < 0) {
      setError('Libellé et prix valides requis.');
      return;
    }
    setAddingTicket(true);
    try {
      const res = await fetch(`/api/admin/evenementiel/events/${event.id}/ticket-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim(), price }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error ?? 'Erreur.');
        return;
      }
      setTicketTypes((prev) => [...prev, result]);
      setNewLabel(''); setNewPrice('');
    } finally {
      setAddingTicket(false);
    }
  }

  async function removeTicketType(id: string) {
    const res = await fetch(`/api/admin/evenementiel/ticket-types/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const result = await res.json();
      if (result.deactivated) {
        setTicketTypes((prev) => prev.map((t) => (t.id === id ? { ...t, active: false } : t)));
      } else {
        setTicketTypes((prev) => prev.filter((t) => t.id !== id));
      }
    }
  }

  async function refundReservation(id: string) {
    if (!confirm('Rembourser cette réservation et libérer les places ?')) return;
    setRefunding(id);
    try {
      const res = await fetch(`/api/admin/evenementiel/reservations/${id}/refund`, { method: 'POST' });
      if (res.ok) {
        setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'refunded' } : r)));
      }
    } finally {
      setRefunding(null);
    }
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/evenementiel/evenements" className="text-sm text-gray-500 flex items-center gap-1.5 hover:text-gray-700">
        <IconArrowLeft size={14} /> Retour aux événements
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{event.title}</h1>
          <p className="text-sm text-gray-500">
            {formatDate(event.date_start)} · {event.capacity_remaining}/{event.capacity_total} places restantes
          </p>
        </div>
        <select
          value={event.status}
          onChange={(e) => updateStatus(e.target.value as EventStatus)}
          disabled={savingStatus}
          className={inputClass}
        >
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Formules */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Formules</p>
        <div className="space-y-2 mb-3">
          {ticketTypes.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-50 last:border-0">
              <div className="min-w-0">
                <p className={`text-sm font-medium ${t.active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{t.label}</p>
                <p className="text-xs text-gray-500">{formatPrice(t.price, currency)}</p>
              </div>
              <button type="button" onClick={() => removeTicketType(t.id)} className="text-gray-400 hover:text-red-500">
                <IconTrash size={15} />
              </button>
            </div>
          ))}
          {ticketTypes.length === 0 && <p className="text-xs text-gray-400">Aucune formule — ajoutez-en une ci-dessous.</p>}
        </div>
        <form onSubmit={addTicketType} className="flex items-center gap-2">
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Libellé (ex. Formule Repas)" className={`${inputClass} flex-1`} />
          <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="Prix" inputMode="decimal" className={`${inputClass} w-24`} />
          <button
            type="submit"
            disabled={addingTicket}
            className="p-2.5 rounded-lg text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <IconPlus size={16} />
          </button>
        </form>
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
      </section>

      {/* Réservations */}
      <section className="bg-white rounded-2xl border border-gray-100 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Réservations ({reservations.length})</p>
        {reservations.length === 0 ? (
          <p className="text-xs text-gray-400">Aucune réservation pour le moment.</p>
        ) : (
          <div className="space-y-2">
            {reservations.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-2 border-b border-gray-50 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{r.customer_name}</p>
                  <p className="text-xs text-gray-500">
                    {r.customer_email} · {r.quantity_remaining}/{r.quantity_total} places · {formatPrice(r.amount_paid, currency)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-2xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                    {RESERVATION_STATUS_LABELS[r.status]}
                  </span>
                  {r.status === 'confirmed' && (
                    <button
                      type="button"
                      onClick={() => refundReservation(r.id)}
                      disabled={refunding === r.id}
                      className="text-gray-400 hover:text-red-500 disabled:opacity-50"
                      title="Rembourser"
                    >
                      <IconReceiptRefund size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
