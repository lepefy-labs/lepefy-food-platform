'use client';

import { useRef, useState } from 'react';
import { IconUpload, IconTrash } from '@tabler/icons-react';
import type { EventGalleryPhoto } from '@lepefy/types';

export default function GalleryClient({ initialPhotos }: { initialPhotos: EventGalleryPhoto[] }) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        body: JSON.stringify({ image_url: uploadResult.imageUrl }),
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
      <label
        className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl text-white cursor-pointer w-fit disabled:opacity-50"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        <IconUpload size={16} /> {uploading ? 'Téléversement…' : 'Ajouter une photo'}
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
      </label>

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
