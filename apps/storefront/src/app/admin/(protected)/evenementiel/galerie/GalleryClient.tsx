'use client';

import { useRef, useState } from 'react';
import { IconShare3, IconTrash, IconUpload } from '@tabler/icons-react';
import { formatDate } from '@/lib/utils/format';
import type { EventGalleryPhoto, EventRow } from '@lepefy/types';

export type GalleryEventOption = Pick<EventRow, 'id' | 'title' | 'date_start'>;

const SELECT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary,var(--color-primary))] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

interface GalleryClientProps {
  initialPhotos: EventGalleryPhoto[];
  events: GalleryEventOption[];
}

export default function GalleryClient({ initialPhotos, events }: GalleryClientProps) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const eventTitleById = new Map(events.map((event) => [event.id, event.title]));

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', 'gallery');

      const uploadRes = await fetch('/api/admin/evenementiel/upload-image', { method: 'POST', body: formData });
      const uploadResult = await uploadRes.json();
      if (!uploadRes.ok) {
        setError(uploadResult.error ?? 'Erreur lors du téléversement.');
        return;
      }

      const createRes = await fetch('/api/admin/evenementiel/gallery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: uploadResult.imageUrl, event_id: selectedEventId || null }),
      });
      const createResult = await createRes.json();
      if (!createRes.ok) {
        setError(createResult.error ?? 'Erreur lors de l\'enregistrement.');
        return;
      }

      setPhotos((prev) => [...prev, { ...createResult, is_social_share: Boolean(createResult.is_social_share) }]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSocialToggle(photo: EventGalleryPhoto) {
    if (!photo.event_id || updatingId) return;
    setError(null);
    setUpdatingId(photo.id);
    try {
      const nextValue = !Boolean(photo.is_social_share);
      const res = await fetch(`/api/admin/evenementiel/gallery/${photo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_social_share: nextValue }),
      });
      const result = await res.json();
      if (!res.ok) {
        setError(result.error ?? 'Impossible de modifier le partage social. Vérifiez que la migration 081 est appliquée.');
        return;
      }
      setPhotos((prev) => prev.map((item) => (item.id === photo.id ? { ...item, ...result } : item)));
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/evenementiel/gallery/${id}`, { method: 'DELETE' });
    if (res.ok) setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4 text-sm text-violet-950">
        <div className="flex gap-3">
          <IconShare3 size={20} className="mt-0.5 shrink-0 text-violet-600" />
          <div>
            <p className="font-semibold">Kit social des événements</p>
            <p className="mt-1 text-xs leading-relaxed text-violet-800/80">
              Activez « Partage social » uniquement sur les photos que les visiteurs peuvent utiliser pour leurs statuts et stories. Une photo doit être associée à un événement.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label
          className="flex min-h-11 w-fit cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--admin-primary, var(--color-primary))' }}
        >
          <IconUpload size={16} /> {uploading ? 'Téléversement…' : 'Ajouter une photo'}
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
        </label>

        <div className="w-full sm:w-72">
          <label className={LABEL_CLS} htmlFor="gallery-event-select">Associer à un événement (optionnel)</label>
          <select
            id="gallery-event-select"
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">Aucun (galerie générale)</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} — {formatDate(event.date_start)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

      {photos.length === 0 ? (
        <p className="rounded-2xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-400">
          Aucune photo pour le moment.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo) => {
            const socialEnabled = Boolean(photo.is_social_share);
            const hasEvent = Boolean(photo.event_id);
            return (
              <article key={photo.id} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                <div className="group relative aspect-square overflow-hidden bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.image_url} alt={photo.caption ?? ''} className="h-full w-full object-cover" />
                  {socialEnabled && (
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-violet-600 px-2 py-1 text-[10px] font-bold text-white shadow-sm">
                      <IconShare3 size={12} /> SOCIAL
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(photo.id)}
                    aria-label="Supprimer la photo"
                    className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-black/65 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <IconTrash size={14} />
                  </button>
                </div>

                <div className="space-y-2 p-2.5">
                  <p className="truncate text-[11px] font-medium text-gray-600">
                    {photo.event_id && eventTitleById.get(photo.event_id) ? eventTitleById.get(photo.event_id) : 'Galerie générale'}
                  </p>
                  <button
                    type="button"
                    disabled={!hasEvent || updatingId === photo.id}
                    onClick={() => handleSocialToggle(photo)}
                    aria-pressed={socialEnabled}
                    className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-xl border px-2.5 text-left text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                      socialEnabled
                        ? 'border-violet-200 bg-violet-50 text-violet-700'
                        : 'border-gray-200 bg-gray-50 text-gray-600'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <span>{hasEvent ? 'Partage social' : 'Associez à un événement'}</span>
                    <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${socialEnabled ? 'bg-violet-600' : 'bg-gray-300'}`} aria-hidden="true">
                      <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition ${socialEnabled ? 'left-[18px]' : 'left-0.5'}`} />
                    </span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
