'use client';

import { useEffect, useState } from 'react';
import { IconClock } from '@tabler/icons-react';
import type { EventRow } from '@lepefy/types';

interface Props {
  event: EventRow;
}

function toDateTimeLocal(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDeadline(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function EventBookingDeadlineAdminCard({ event }: Props) {
  const [bookingClosesAt, setBookingClosesAt] = useState(toDateTimeLocal(event.booking_closes_at));
  const [savedValue, setSavedValue] = useState(event.booking_closes_at);
  const [now, setNow] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const deadlineTimestamp = savedValue ? new Date(savedValue).getTime() : null;
  const closed = now !== null && deadlineTimestamp !== null && !Number.isNaN(deadlineTimestamp) && deadlineTimestamp <= now;
  const hoursRemaining = now !== null && deadlineTimestamp !== null && !closed ? (deadlineTimestamp - now) / 3_600_000 : null;
  const status = !savedValue ? 'Non configurée' : closed ? 'Clôturée' : hoursRemaining !== null && hoursRemaining <= 6 ? 'Dernières heures' : 'Ouverte';
  const statusClass = !savedValue
    ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
    : closed
      ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
      : hoursRemaining !== null && hoursRemaining <= 6
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
        : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300';

  async function save() {
    setError(null);
    setSaved(false);

    let normalized: string | null = null;
    if (bookingClosesAt) {
      const date = new Date(bookingClosesAt);
      if (Number.isNaN(date.getTime())) {
        setError('Date de fin des réservations invalide.');
        return;
      }
      if (date.getTime() >= new Date(event.date_start).getTime()) {
        setError('La fin des réservations doit être antérieure au début de l’événement.');
        return;
      }
      normalized = date.toISOString();
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/admin/evenementiel/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_closes_at: normalized }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? 'Erreur lors de l’enregistrement de la fin des réservations.');
        return;
      }
      setSavedValue((result as EventRow).booking_closes_at);
      setBookingClosesAt(toDateTimeLocal((result as EventRow).booking_closes_at));
      setNow(Date.now());
      setSaved(true);
    } catch {
      setError('Erreur réseau lors de l’enregistrement.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <IconClock size={16} className="text-[var(--color-primary-dark)]" />
          <h2 className="text-sm font-semibold text-gray-950 dark:text-white">Réservations en ligne</h2>
        </div>
        <span className={`rounded-full px-2 py-1 text-2xs font-semibold ${statusClass}`}>{status}</span>
      </div>
      <div className="p-4">
        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">
          Fin des réservations
          <input
            type="datetime-local"
            value={bookingClosesAt}
            max={toDateTimeLocal(event.date_start)}
            onChange={(e) => { setBookingClosesAt(e.target.value); setSaved(false); }}
            className="mt-1 min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
          />
        </label>
        <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          À cette date, le checkout public est fermé automatiquement. Les réservations manuelles enregistrées par l’admin restent possibles.
        </p>
        {savedValue && <p className="mt-2 text-xs font-medium text-gray-600 dark:text-gray-300">Clôture actuelle : {formatDeadline(savedValue)}</p>}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        {saved && !error && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Fin des réservations enregistrée.</p>}
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => void save()} disabled={saving} className="min-h-11 flex-1 rounded-lg bg-[var(--color-primary)] px-3 text-sm font-semibold text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-60">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          {bookingClosesAt && <button type="button" onClick={() => { setBookingClosesAt(''); setSaved(false); }} disabled={saving} className="min-h-11 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5">Effacer</button>}
        </div>
      </div>
    </section>
  );
}
