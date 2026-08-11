'use client';

import { useRef, useState } from 'react';
import { IconUpload, IconTrash } from '@tabler/icons-react';
import { formatDate } from '@/lib/utils/format';
import type { EventGalleryPhoto, EventRow } from '@lepefy/types';

export type GalleryEventOption = Pick<EventRow, 'id' | 'title' | 'date_start'>;

const SELECT_CLS =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent bg-white text-gray-900';
const LABEL_CLS = 'text-gray-400 text-xs uppercase tracking-wide mb-0.5 block';

interface GalleryClientProps {
  initialPhotos: EventGalleryPhoto[];
  events: GalleryEventOption[];
}

export default function GalleryClient({ initialPhotos, events }: GalleryClientProps) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [uploading, setUploading] = useState(false);
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

      setPhotos((prev) => [...prev, createResult]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/admin/evenementiel/gallery/${id}`, { method: 'DELETE' });
    if (res.ok) setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label
          className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl text-white cursor-pointer w-fit disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
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

      {error && <p className="text-red-500 text-xs">{error}</p>}

      {photos.length === 0 ? (
        <p className="text-sm text-gray-400 bg-white rounded-2xl border border-gray-100 p-6 text-center">
          Aucune photo pour le moment.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {photos.map((photo) => (
            <div key={photo.id} className="relative aspect-square rounded-2xl overflow-hidden bg-gray-100 group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.image_url} alt={photo.caption ?? ''} className="w-full h-full object-cover" />
              {photo.event_id && eventTitleById.get(photo.event_id) && (
                <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-2xs px-2 py-1 truncate">
                  {eventTitleById.get(photo.event_id)}
                </span>
              )}
              <button
                type="button"
                onClick={() => handleDelete(photo.id)}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
