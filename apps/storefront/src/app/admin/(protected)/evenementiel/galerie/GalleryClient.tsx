'use client';

import { useRef, useState } from 'react';
import { IconPencil, IconShare3, IconTrash, IconUpload } from '@tabler/icons-react';
import { formatDate } from '@/lib/utils/format';
import { GALLERY_CATEGORIES, HERO_PRIORITIES, heroPriorityOption } from '@/lib/events/galleryEditorial';
import type { EventGalleryCategory, EventGalleryPhoto, EventRow } from '@lepefy/types';

export type GalleryEventOption = Pick<EventRow, 'id' | 'title' | 'date_start'>;
type EditorialDraft = Pick<EventGalleryPhoto, 'category' | 'event_id' | 'hero_eligible' | 'hero_priority' | 'caption'>;
type GalleryFilter = 'all' | 'hero' | EventGalleryCategory;

const SELECT_CLS = 'min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary,var(--color-primary))]';
const LABEL_CLS = 'mb-1 block text-xs font-medium text-gray-600';
const BUTTON_CLS = 'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50';
const DEFAULT_DRAFT: EditorialDraft = { category: 'general', event_id: null, hero_eligible: false, hero_priority: 50, caption: null };

function EditorialFields({ draft, onChange, events, id, columns = false }: {
  draft: EditorialDraft;
  onChange: (draft: EditorialDraft) => void;
  events: GalleryEventOption[];
  id: string;
  columns?: boolean;
}) {
  return (
    <div className={columns ? "grid gap-3 sm:grid-cols-3" : "space-y-3"}>
      <div>
        <label className={LABEL_CLS} htmlFor={id + '-category'}>Catégorie</label>
        <select id={id + '-category'} className={SELECT_CLS} value={draft.category} onChange={(e) => onChange({ ...draft, category: e.target.value as EventGalleryCategory })}>
          {GALLERY_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
        </select>
      </div>
      <div>
        <label className={LABEL_CLS + (draft.category === 'event' ? ' font-semibold text-violet-700' : '')} htmlFor={id + '-event'}>Associer à un événement (optionnel)</label>
        <select id={id + '-event'} className={SELECT_CLS} value={draft.event_id ?? ''} onChange={(e) => onChange({ ...draft, event_id: e.target.value || null })}>
          <option value="">Aucun événement</option>
          {events.map((event) => <option key={event.id} value={event.id}>{event.title} — {formatDate(event.date_start)}</option>)}
        </select>
      </div>
      <div>
        <label className={LABEL_CLS} htmlFor={id + '-caption'}>Légende (optionnel)</label>
        <input id={id + '-caption'} className={SELECT_CLS} maxLength={2000} value={draft.caption ?? ''} onChange={(e) => onChange({ ...draft, caption: e.target.value || null })} />
      </div>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-gray-700">
        <input type="checkbox" className="size-4 accent-violet-600" checked={draft.hero_eligible} onChange={(e) => onChange({ ...draft, hero_eligible: e.target.checked })} />
        Utiliser dans le hero
      </label>
      {draft.hero_eligible && (
        <div>
          <label className={LABEL_CLS} htmlFor={id + '-priority'}>Priorité hero</label>
          <select id={id + '-priority'} className={SELECT_CLS} value={heroPriorityOption(draft.hero_priority)} onChange={(e) => onChange({ ...draft, hero_priority: Number(e.target.value) })}>
            {HERO_PRIORITIES.map((priority) => <option key={priority.value} value={priority.value}>{priority.label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

function PhotoEditor({ photo, events, busy, onSave, onCancel }: {
  photo: EventGalleryPhoto;
  events: GalleryEventOption[];
  busy: boolean;
  onSave: (draft: EditorialDraft) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<EditorialDraft>({
    category: photo.category ?? (photo.event_id ? 'event' : 'general'),
    event_id: photo.event_id,
    caption: photo.caption,
    hero_eligible: Boolean(photo.hero_eligible),
    hero_priority: photo.hero_priority ?? 50,
  });
  return (
    <form id={'gallery-editor-' + photo.id} className="border-t border-gray-100 p-3" onSubmit={async (e) => { e.preventDefault(); if (await onSave(draft)) onCancel(); }}>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="mb-3 text-xs font-semibold text-gray-900">Modifier la photo</legend>
        <EditorialFields id={'edit-' + photo.id} draft={draft} onChange={setDraft} events={events} />
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={BUTTON_CLS + ' bg-violet-600 text-white'}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          <button type="button" className={BUTTON_CLS} onClick={onCancel}>Annuler</button>
        </div>
      </fieldset>
    </form>
  );
}

export default function GalleryClient({ initialPhotos, events }: { initialPhotos: EventGalleryPhoto[]; events: GalleryEventOption[] }) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<GalleryFilter>('all');
  const [draft, setDraft] = useState<EditorialDraft>(DEFAULT_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const busy = uploading || updatingId !== null;
  const eventTitleById = new Map(events.map((event) => [event.id, event.title]));
  const visiblePhotos = photos.filter((photo) => filter === 'all' || (filter === 'hero' ? photo.hero_eligible : (photo.category ?? (photo.event_id ? 'event' : 'general')) === filter));

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || busy) return;
    setError(null);
    setNotice(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', 'gallery');
      const uploadRes = await fetch('/api/admin/evenementiel/upload-image', { method: 'POST', body: formData });
      const uploadResult = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadResult.error ?? 'Erreur lors du téléversement.');
      const createRes = await fetch('/api/admin/evenementiel/gallery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: uploadResult.imageUrl, ...draft }),
      });
      const result = await createRes.json();
      if (!createRes.ok) throw new Error(result.error ?? 'Erreur lors de l’enregistrement.');
      setPhotos((prev) => [...prev, result]);
      setNotice('Photo ajoutée.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible d’ajouter la photo. Réessayez.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function updatePhoto(photo: EventGalleryPhoto, changes: Partial<EditorialDraft> & { is_social_share?: boolean }) {
    if (busy) return false;
    setError(null);
    setNotice(null);
    setUpdatingId(photo.id);
    try {
      const res = await fetch(`/api/admin/evenementiel/gallery/${photo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? 'Impossible de modifier la photo.');
      setPhotos((prev) => prev.map((item) => item.id === photo.id ? { ...item, ...result } : item));
      setNotice('Photo mise à jour.');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de modifier la photo. Réessayez.');
      return false;
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDelete(id: string) {
    if (busy) return;
    setUpdatingId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/evenementiel/gallery/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error ?? 'Impossible de supprimer la photo.');
      }
      setPhotos((prev) => prev.filter((photo) => photo.id !== id));
      if (editingId === id) setEditingId(null);
      setNotice('Photo supprimée.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Impossible de supprimer la photo. Réessayez.');
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4 text-sm text-violet-950">
        <div className="flex gap-3">
          <IconShare3 size={20} className="mt-0.5 shrink-0 text-violet-600" />
          <div>
            <p className="font-semibold">Hero et kit social</p>
            <p className="mt-1 text-xs leading-relaxed text-violet-800/80">
              Choisissez les photos à mettre en avant dans le hero. Le partage social reste indépendant : activez-le uniquement pour les photos associées à un événement que les visiteurs peuvent utiliser dans leurs statuts et stories.
            </p>
          </div>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrer la galerie">
        {[{ value: 'all', label: 'Toutes' }, ...GALLERY_CATEGORIES.map((category) => ({ value: category.value, label: category.filterLabel })), { value: 'hero', label: 'Hero' }].map((item) => (
          <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => { setFilter(item.value as GalleryFilter); setEditingId(null); }} className={BUTTON_CLS + ' shrink-0 rounded-full ' + (filter === item.value ? 'border-violet-200 bg-violet-50 text-violet-700' : 'bg-white text-gray-600')}>{item.label}</button>
        ))}
      </div>
      <fieldset disabled={busy} className="rounded-2xl border border-gray-100 bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-gray-900">Ajouter une photo</legend>
        <div className="grid items-end gap-4 sm:grid-cols-[1fr_auto]">
          <EditorialFields columns id="upload-gallery" draft={draft} onChange={setDraft} events={events} />
          <div>
            <button type="button" className={BUTTON_CLS + ' w-full bg-violet-600 text-white sm:w-auto'} onClick={() => fileInputRef.current?.click()}>
              <IconUpload size={16} /> {uploading ? 'Téléversement…' : 'Ajouter une photo'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="Choisir une photo" onChange={handleFileChange} disabled={busy} />
          </div>
        </div>
      </fieldset>
      {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <p role="status" className="text-xs text-gray-600">{uploading ? 'Téléversement en cours…' : notice}</p>
      {visiblePhotos.length === 0 ? (
        <p className="rounded-2xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-500">{photos.length === 0 ? 'Aucune photo pour le moment.' : 'Aucune photo dans ce filtre.'}</p>
      ) : (
        <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visiblePhotos.map((photo) => {
            const socialEnabled = Boolean(photo.is_social_share);
            const category = GALLERY_CATEGORIES.find((item) => item.value === (photo.category ?? (photo.event_id ? 'event' : 'general')));
            const editing = editingId === photo.id;
            return (
              <article key={photo.id} className={`overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm ${editing ? 'col-span-2 sm:col-span-1' : ''}`}>
                <div className="group relative aspect-square overflow-hidden bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.image_url} alt={photo.caption ?? ''} loading="lazy" className="h-full w-full object-cover" />
                  <div className="absolute left-2 right-14 top-2 flex flex-wrap gap-1 text-[9px] font-bold uppercase">
                    <span className="rounded-full bg-black/70 px-2 py-1 text-white">{category?.filterLabel ?? 'Général'}</span>
                    {photo.hero_eligible && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-900">HERO</span>}
                    {socialEnabled && <span className="rounded-full bg-violet-600 px-2 py-1 text-white">SOCIAL</span>}
                  </div>
                  <button type="button" disabled={busy} onClick={() => handleDelete(photo.id)} aria-label="Supprimer la photo" className="absolute right-2 top-2 flex size-11 items-center justify-center rounded-full bg-black/65 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50">
                    <IconTrash size={16} />
                  </button>
                </div>
                <div className="space-y-2 p-2.5">
                  <p className="truncate text-[11px] font-medium text-gray-600">{photo.event_id && eventTitleById.get(photo.event_id) ? eventTitleById.get(photo.event_id) : category?.label ?? 'Galerie générale'}</p>
                  {photo.caption && <p className="line-clamp-2 text-xs text-gray-500">{photo.caption}</p>}
                  <button type="button" disabled={busy} onClick={() => setEditingId(editing ? null : photo.id)} aria-expanded={editing} aria-controls={'gallery-editor-' + photo.id} className={BUTTON_CLS + ' w-full text-gray-700'}>
                    <IconPencil size={14} /> {editing ? 'Fermer' : 'Modifier'}
                  </button>
                  <button type="button" disabled={!photo.event_id || busy} onClick={() => updatePhoto(photo, { is_social_share: !socialEnabled })} aria-pressed={socialEnabled} className={BUTTON_CLS + ' w-full justify-between ' + (socialEnabled ? 'border-violet-200 bg-violet-50 text-violet-700' : 'bg-gray-50 text-gray-600')}>
                    <span>{photo.event_id ? 'Partage social' : 'Associez à un événement'}</span>
                    <span className={`relative h-5 w-9 shrink-0 rounded-full ${socialEnabled ? 'bg-violet-600' : 'bg-gray-300'}`} aria-hidden="true">
                      <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow ${socialEnabled ? 'left-[18px]' : 'left-0.5'}`} />
                    </span>
                  </button>
                </div>
                {editing && <PhotoEditor photo={photo} events={events} busy={busy} onSave={(changes) => updatePhoto(photo, changes)} onCancel={() => setEditingId(null)} />}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
