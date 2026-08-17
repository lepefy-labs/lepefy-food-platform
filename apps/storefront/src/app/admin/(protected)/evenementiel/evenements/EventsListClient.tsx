'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { IconPlus, IconCalendarEvent, IconUpload, IconTrash } from '@tabler/icons-react';
import { slugify, formatDate } from '@/lib/utils/format';
import Button from '../../../_components/ui/Button';
import type { EventRow, EventStatus } from '@lepefy/types';

interface DraftTicketType {
  label: string;
  description: string;
  price: string;
}

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
  const [bannerImageUrl, setBannerImageUrl] = useState<string | null>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [ticketTypes, setTicketTypes] = useState<DraftTicketType[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';
  // Variante sans `w-full` pour les champs à l'intérieur d'une rangée flex
  // (formules) — combiner `w-full` et `flex-1` sur le même input écrase le
  // partage d'espace du flexbox et réduit le champ à quelques pixels.
  const flexInputClass = 'border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  async function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadingBanner(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', 'event-banner');
      const res = await fetch('/api/admin/evenementiel/upload-image', { method: 'POST', body: formData });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error ?? 'Erreur lors du téléversement de la bannière.');
        return;
      }
      setBannerImageUrl(result.imageUrl);
    } finally {
      setUploadingBanner(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function addTicketTypeRow() {
    setTicketTypes((prev) => [...prev, { label: '', description: '', price: '' }]);
  }

  function updateTicketTypeRow(index: number, field: keyof DraftTicketType, value: string) {
    setTicketTypes((prev) => prev.map((t, i) => (i === index ? { ...t, [field]: value } : t)));
  }

  function removeTicketTypeRow(index: number) {
    setTicketTypes((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const capacityNum = Number(capacity);
    if (!title.trim() || !dateStart || !Number.isInteger(capacityNum) || capacityNum < 0) {
      setError('Titre, date et capacité valides requis.');
      return;
    }

    const ticketTypesPayload: { label: string; description: string | null; price: number }[] = [];
    for (const t of ticketTypes) {
      const price = Number(t.price);
      if (!t.label.trim() || !Number.isFinite(price) || price < 0) {
        setError('Chaque formule doit avoir un libellé et un prix valides.');
        return;
      }
      ticketTypesPayload.push({ label: t.label.trim(), description: t.description.trim() || null, price });
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
          banner_image_url: bannerImageUrl,
          ticket_types: ticketTypesPayload,
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
      setBannerImageUrl(null); setTicketTypes([]);
    } catch {
      setError('Erreur réseau.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button type="button" onClick={() => setShowForm((v) => !v)}>
        <IconPlus size={16} /> Nouvel événement
      </Button>

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

          <div>
            <p className="text-xs font-semibold text-gray-600 mb-1.5">Bannière</p>
            {bannerImageUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={bannerImageUrl} alt="Aperçu de la bannière" className="w-full max-h-40 object-cover rounded-lg mb-2" />
            )}
            <label
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-gray-200 cursor-pointer w-fit disabled:opacity-50"
            >
              <IconUpload size={14} /> {uploadingBanner ? 'Téléversement…' : bannerImageUrl ? 'Changer l\'image' : 'Ajouter une bannière'}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerChange} disabled={uploadingBanner} />
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-gray-600">Formules</p>
              <Button type="button" variant="ghost" size="sm" onClick={addTicketTypeRow}>
                <IconPlus size={14} /> Ajouter une formule
              </Button>
            </div>
            {ticketTypes.length === 0 && (
              <p className="text-xs text-gray-400">Aucune formule — un événement publié doit avoir au moins une formule.</p>
            )}
            <div className="space-y-2">
              {ticketTypes.map((t, i) => (
                <div key={i} className="flex flex-col gap-1.5 border border-gray-50 rounded-lg p-2">
                  <div className="flex items-start gap-2">
                    <input
                      value={t.label}
                      onChange={(e) => updateTicketTypeRow(i, 'label', e.target.value)}
                      placeholder="Nom de la formule (ex. Formule Repas)"
                      className={`${flexInputClass} flex-1 min-w-0`}
                    />
                    <input
                      value={t.price}
                      onChange={(e) => updateTicketTypeRow(i, 'price', e.target.value)}
                      placeholder="Prix €"
                      inputMode="decimal"
                      className={`${flexInputClass} w-24 shrink-0`}
                    />
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeTicketTypeRow(i)} className="shrink-0">
                      <IconTrash size={16} />
                    </Button>
                  </div>
                  <input
                    value={t.description}
                    onChange={(e) => updateTicketTypeRow(i, 'description', e.target.value)}
                    placeholder="Description (optionnel)"
                    className={inputClass}
                  />
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}
          <Button type="submit" loading={isSubmitting}>
            {isSubmitting ? 'Création…' : 'Créer'}
          </Button>
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
