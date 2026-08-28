'use client';

import { useEffect, useRef, useState } from 'react';
import { IconPhoto, IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';
import Button from '../../../../../_components/ui/Button';
import { HIGHLIGHT_ICON_OPTIONS } from '@/lib/events/highlightIcons';
import type { EventHighlight, EventRow } from '@lepefy/types';

export default function EventPageTab({
  event,
  subtitle,
  onSubtitleChange,
  highlights,
  onAddHighlight,
  onUpdateHighlight,
  onRemoveHighlight,
  onSave,
  saving,
  error,
  saved,
  uploadingBanner,
  fileInputRef,
  onBannerChange,
  maxHighlights,
}: {
  event: EventRow;
  subtitle: string;
  onSubtitleChange: (value: string) => void;
  highlights: EventHighlight[];
  onAddHighlight: () => void;
  onUpdateHighlight: (index: number, field: keyof EventHighlight, value: string) => void;
  onRemoveHighlight: (index: number) => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
  saved: boolean;
  uploadingBanner: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onBannerChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  maxHighlights: number;
}) {
  const inputClass = 'min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
  const priceListInputRef = useRef<HTMLInputElement>(null);
  const [priceListImageUrl, setPriceListImageUrl] = useState(event.on_site_price_list_image_url);
  const [uploadingPriceList, setUploadingPriceList] = useState(false);
  const [removingPriceList, setRemovingPriceList] = useState(false);
  const [priceListError, setPriceListError] = useState<string | null>(null);
  const priceListBusy = uploadingPriceList || removingPriceList;

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/admin/evenementiel/events/${event.id}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ event?: EventRow }>;
      })
      .then((result) => {
        if (!cancelled && result?.event) setPriceListImageUrl(result.event.on_site_price_list_image_url);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [event.id]);

  async function patchPriceList(imageUrl: string | null) {
    const response = await fetch(`/api/admin/evenementiel/events/${event.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on_site_price_list_image_url: imageUrl }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Erreur lors de l’enregistrement des tarifs sur place.');
    const updatedEvent = result as EventRow;
    setPriceListImageUrl(updatedEvent.on_site_price_list_image_url);
  }

  async function handlePriceListChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPriceListError(null);
    setUploadingPriceList(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('kind', 'event-price-list');
      const uploadResponse = await fetch('/api/admin/evenementiel/upload-image', { method: 'POST', body: formData });
      const uploadResult = await uploadResponse.json();
      if (!uploadResponse.ok) throw new Error(uploadResult.error ?? 'Erreur lors du téléversement de la carte des prix.');
      await patchPriceList(uploadResult.imageUrl as string);
    } catch (uploadError) {
      setPriceListError(uploadError instanceof Error ? uploadError.message : 'Erreur lors du téléversement de la carte des prix.');
    } finally {
      setUploadingPriceList(false);
      if (priceListInputRef.current) priceListInputRef.current.value = '';
    }
  }

  async function removePriceList() {
    setPriceListError(null);
    setRemovingPriceList(true);
    try {
      await patchPriceList(null);
    } catch (removeError) {
      setPriceListError(removeError instanceof Error ? removeError.message : 'Erreur lors de la suppression de la carte des prix.');
    } finally {
      setRemovingPriceList(false);
    }
  }

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,.8fr)]">
      <div className="space-y-4">
        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3"><h2 className="text-sm font-semibold text-gray-950 dark:text-white">Visuel principal</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Bannière affichée sur la page publique.</p></div>
          {event.banner_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.banner_image_url} alt="Bannière de l’événement" className="mb-3 max-h-72 w-full rounded-lg object-cover" />
          ) : (
            <div className="mb-3 grid min-h-36 place-items-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-950/50">Aucune bannière configurée</div>
          )}
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-white/5">
            <IconUpload size={15} /> {uploadingBanner ? 'Téléversement…' : event.banner_image_url ? 'Remplacer l’image' : 'Ajouter une bannière'}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onBannerChange} disabled={uploadingBanner} />
          </label>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]"><IconPhoto size={18} /></div>
            <div><h2 className="text-sm font-semibold text-gray-950 dark:text-white">Tarifs sur place</h2><p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">Carte informative des plats et boissons vendus le jour de l’événement. Elle reste distincte des formules réservables en ligne.</p></div>
          </div>
          {priceListImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={priceListImageUrl} alt="Carte des tarifs sur place" className="mb-3 max-h-[460px] w-full rounded-lg border border-gray-100 bg-gray-50 object-contain dark:border-gray-800 dark:bg-gray-950/50" />
          ) : (
            <div className="mb-3 grid min-h-40 place-items-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-950/50">Aucune carte de prix. La section « Tarifs sur place » restera masquée sur la page publique.</div>
          )}
          {priceListError && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{priceListError}</p>}
          <div className="flex flex-wrap gap-2">
            <label className={`inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200 ${priceListBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5'}`}>
              <IconUpload size={15} /> {uploadingPriceList ? 'Téléversement…' : priceListImageUrl ? 'Remplacer la carte' : 'Ajouter la carte des prix'}
              <input ref={priceListInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePriceListChange} disabled={priceListBusy} />
            </label>
            {priceListImageUrl && <Button type="button" variant="outline" size="sm" onClick={() => void removePriceList()} disabled={priceListBusy} className="min-h-11 text-red-600 hover:text-red-700"><IconTrash size={15} /> {removingPriceList ? 'Suppression…' : 'Supprimer'}</Button>}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3"><h2 className="text-sm font-semibold text-gray-950 dark:text-white">Hero</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Le sous-titre est optionnel.</p></div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Sous-titre<input value={subtitle} onChange={(e) => onSubtitleChange(e.target.value)} placeholder="ex. La Première" className={`${inputClass} mt-1`} /></label>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-gray-950 dark:text-white">Points forts</h2><p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Jusqu’à {maxHighlights} éléments sur la page publique.</p></div>{highlights.length < maxHighlights && <Button type="button" variant="outline" size="sm" onClick={onAddHighlight}><IconPlus size={14} /> Ajouter</Button>}</div>
          {highlights.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">Aucun point fort configuré. Cette section reste masquée sur la page événement.</p> : (
            <div className="space-y-3">{highlights.map((highlight, index) => (
              <div key={index} className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
                <div className="mb-2 flex items-center justify-between"><p className="text-2xs font-semibold uppercase tracking-wide text-gray-400">Point fort {index + 1}</p><button type="button" onClick={() => onRemoveHighlight(index)} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-gray-400 hover:bg-gray-50 hover:text-red-600 dark:hover:bg-white/5" aria-label={`Supprimer le point fort ${index + 1}`}><IconTrash size={15} /></button></div>
                <div className="mb-2 flex flex-wrap gap-1.5">{HIGHLIGHT_ICON_OPTIONS.map(({ key, Icon }) => <button key={key} type="button" onClick={() => onUpdateHighlight(index, 'icon', key)} className={`grid min-h-10 min-w-10 place-items-center rounded-lg border ${highlight.icon === key ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]' : 'border-gray-200 text-gray-400 dark:border-gray-700'}`} aria-label={`Icône ${key}`} title={key}><Icon size={17} /></button>)}</div>
                <div className="grid gap-2"><input value={highlight.title} onChange={(e) => onUpdateHighlight(index, 'title', e.target.value)} placeholder="Titre" className={inputClass} /><textarea value={highlight.text} onChange={(e) => onUpdateHighlight(index, 'text', e.target.value)} placeholder="Texte" rows={2} className={`${inputClass} resize-none py-2`} /></div>
              </div>
            ))}</div>
          )}
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="text-sm font-semibold text-gray-950 dark:text-white">Enregistrer</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Le sous-titre et les points forts sont enregistrés ensemble. La bannière et la carte des prix sont enregistrées immédiatement après téléversement.</p>
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
          {saved && !error && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Modifications enregistrées.</p>}
          <Button type="button" onClick={onSave} loading={saving} className="mt-4 w-full">{saving ? 'Enregistrement…' : 'Enregistrer les modifications'}</Button>
        </section>
        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"><h2 className="text-sm font-semibold text-gray-950 dark:text-white">État du contenu</h2><div className="mt-3 space-y-2 text-sm"><div className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">Bannière</span><strong className="text-gray-900 dark:text-gray-100">{event.banner_image_url ? 'Configurée' : 'Non renseignée'}</strong></div><div className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">Tarifs sur place</span><strong className="text-gray-900 dark:text-gray-100">{priceListImageUrl ? 'Configurés' : 'Non renseignés'}</strong></div><div className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">Sous-titre</span><strong className="text-gray-900 dark:text-gray-100">{subtitle.trim() ? 'Configuré' : 'Optionnel'}</strong></div><div className="flex justify-between gap-3"><span className="text-gray-500 dark:text-gray-400">Points forts</span><strong className="text-gray-900 dark:text-gray-100">{highlights.length} / {maxHighlights}</strong></div></div></section>
      </aside>
    </div>
  );
}
