'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IconPlus, IconCalendarEvent } from '@tabler/icons-react';
import { slugify, formatDate } from '@/lib/utils/format';
import type { EventRow, EventStatus } from '@lepefy/types';

const STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Brouillon',
  published: 'Publié',
  closed: 'Clôturé',
  cancelled: 'Annulé',
};

const STATUS_COLORS: Record<EventStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  published: 'bg-green-100 text-green-700',
  closed: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function EventsListClient({ initialEvents }: { initialEvents: EventRow[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const capacityNum = Number(capacity);
    if (!title.trim() || !dateStart || !Number.isInteger(capacityNum) || capacityNum < 0) {
      setError('Titre, date et capacité valides requis.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/admin/evenementiel/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          slug: slugify(title),
          date_start: new Date(dateStart).toISOString(),
          location: location.trim() || null,
          capacity_total: capacityNum,
          status: 'draft',
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error ?? 'Erreur lors de la création.');
        return;
      }
      setEvents((prev) => [result, ...prev]);
      setShowForm(false);
      setTitle(''); setDateStart(''); setLocation(''); setCapacity('');
    } catch {
      setError('Erreur réseau.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setShowForm((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl text-white"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        <IconPlus size={16} /> Nouvel événement
      </button>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre de l'événement" className={inputClass} />
          <div className="grid grid-cols-2 gap-3">
            <input value={dateStart} onChange={(e) => setDateStart(e.target.value)} type="datetime-local" className={inputClass} />
            <input
              value={capacity}
              onChange={(e) => setCapacity(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              placeholder="Capacité totale"
              className={inputClass}
            />
          </div>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lieu (optionnel)" className={inputClass} />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="text-sm font-semibold px-4 py-2 rounded-xl text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {isSubmitting ? 'Création…' : 'Créer'}
          </button>
        </form>
      )}

      {events.length === 0 ? (
        <p className="text-sm text-gray-400 bg-white rounded-2xl border border-gray-100 p-6 text-center">
          Aucun événement pour le moment.
        </p>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
          {events.map((event) => (
            <Link
              key={event.id}
              href={`/admin/evenementiel/evenements/${event.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div className="min-w-0 flex items-center gap-3">
                <IconCalendarEvent size={16} className="text-gray-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{event.title}</p>
                  <p className="text-xs text-gray-500">
                    {formatDate(event.date_start)} · {event.capacity_remaining}/{event.capacity_total} places
                  </p>
                </div>
              </div>
              <span className={`text-2xs font-semibold px-2 py-1 rounded-full shrink-0 ${STATUS_COLORS[event.status]}`}>
                {STATUS_LABELS[event.status]}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
