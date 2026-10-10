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
  const inputClass = 'min-h-11 w-full rounded-lg border border-a-border bg-a-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-a-focus';
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
        <section className="rounded-xl border border-a-border bg-a-surface p-4">
          <div className="mb-3"><h2 className="text-sm font-semibold text-a-text">Visuel principal</h2><p className="mt-0.5 text-xs text-a-text-3">Bannière affichée sur la page publique.</p></div>
          {event.banner_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={event.banner_image_url} alt="Bannière de l’événement" className="mb-3 max-h-72 w-full rounded-lg object-cover" />
          ) : (
            <div className="mb-3 grid min-h-36 place-items-center rounded-lg border border-dashed border-a-border bg-a-surface-2 text-sm text-a-text-3">Aucune bannière configurée</div>
          )}
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-a-border px-3 text-sm font-semibold text-a-text-2 hover:bg-a-surface-2">
            <IconUpload size={15} /> {uploadingBanner ? 'Téléversement…' : event.banner_image_url ? 'Remplacer l’image' : 'Ajouter une bannière'}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onBannerChange} disabled={uploadingBanner} />
          </label>
        </section>

        <section className="rounded-xl border border-a-border bg-a-surface p-4">
          <div className="mb-3 flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-a-brand-soft text-a-brand-fg"><IconPhoto size={18} /></div>
            <div><h2 className="text-sm font-semibold text-a-text">Tarifs sur place</h2><p className="mt-0.5 text-xs leading-relaxed text-a-text-3">Carte informative des plats et boissons vendus le jour de l’événement. Elle reste distincte des formules réservables en ligne.</p></div>
          </div>
          {priceListImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={priceListImageUrl} alt="Carte des tarifs sur place" className="mb-3 max-h-[460px] w-full rounded-lg border border-a-border bg-a-surface-2 object-contain" />
          ) : (
            <div className="mb-3 grid min-h-40 place-items-center rounded-lg border border-dashed border-a-border bg-a-surface-2 px-4 text-center text-sm text-a-text-3">Aucune carte de prix. La section « Tarifs sur place » restera masquée sur la page publique.</div>
          )}
          {priceListError && <p className="mb-3 rounded-lg bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg">{priceListError}</p>}
          <div className="flex flex-wrap gap-2">
            <label className={`inline-flex min-h-11 items-center gap-2 rounded-lg border border-a-border px-3 text-sm font-semibold text-a-text-2 ${priceListBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-a-surface-2'}`}>
              <IconUpload size={15} /> {uploadingPriceList ? 'Téléversement…' : priceListImageUrl ? 'Remplacer la carte' : 'Ajouter la carte des prix'}
              <input ref={priceListInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePriceListChange} disabled={priceListBusy} />
            </label>
            {priceListImageUrl && <Button type="button" variant="outline" size="sm" onClick={() => void removePriceList()} disabled={priceListBusy} className="min-h-11 text-tone-danger-fg hover:text-tone-danger-fg"><IconTrash size={15} /> {removingPriceList ? 'Suppression…' : 'Supprimer'}</Button>}
          </div>
        </section>

        <section className="rounded-xl border border-a-border bg-a-surface p-4">
          <div className="mb-3"><h2 className="text-sm font-semibold text-a-text">Hero</h2><p className="mt-0.5 text-xs text-a-text-3">Le sous-titre est optionnel.</p></div>
          <label className="block text-xs font-semibold text-a-text-2">Sous-titre<input value={subtitle} onChange={(e) => onSubtitleChange(e.target.value)} placeholder="ex. La Première" className={`${inputClass} mt-1`} /></label>
        </section>

        <section className="rounded-xl border border-a-border bg-a-surface p-4">
          <div className="mb-3 flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-a-text">Points forts</h2><p className="mt-0.5 text-xs text-a-text-3">Jusqu’à {maxHighlights} éléments sur la page publique.</p></div>{highlights.length < maxHighlights && <Button type="button" variant="outline" size="sm" onClick={onAddHighlight}><IconPlus size={14} /> Ajouter</Button>}</div>
          {highlights.length === 0 ? <p className="text-sm text-a-text-3">Aucun point fort configuré. Cette section reste masquée sur la page événement.</p> : (
            <div className="space-y-3">{highlights.map((highlight, index) => (
              <div key={index} className="rounded-lg border border-a-border p-3">
                <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-a-text-3">Point fort {index + 1}</p><button type="button" onClick={() => onRemoveHighlight(index)} className="grid min-h-10 min-w-10 place-items-center rounded-lg text-a-text-3 hover:bg-a-surface-2 hover:text-tone-danger-fg" aria-label={`Supprimer le point fort ${index + 1}`}><IconTrash size={15} /></button></div>
                <div className="mb-2 flex flex-wrap gap-1.5">{HIGHLIGHT_ICON_OPTIONS.map(({ key, Icon }) => <button key={key} type="button" onClick={() => onUpdateHighlight(index, 'icon', key)} className={`grid min-h-10 min-w-10 place-items-center rounded-lg border ${highlight.icon === key ? 'border-a-brand bg-a-brand-soft text-a-brand-fg' : 'border-a-border text-a-text-3'}`} aria-label={`Icône ${key}`} title={key}><Icon size={17} /></button>)}</div>
                <div className="grid gap-2"><input value={highlight.title} onChange={(e) => onUpdateHighlight(index, 'title', e.target.value)} placeholder="Titre" className={inputClass} /><textarea value={highlight.text} onChange={(e) => onUpdateHighlight(index, 'text', e.target.value)} placeholder="Texte" rows={2} className={`${inputClass} resize-none py-2`} /></div>
              </div>
            ))}</div>
          )}
        </section>
      </div>

      <aside className="space-y-4">
        <section className="rounded-xl border border-a-border bg-a-surface p-4">
          <h2 className="text-sm font-semibold text-a-text">Enregistrer</h2>
          <p className="mt-1 text-xs text-a-text-3">Le sous-titre et les points forts sont enregistrés ensemble. La bannière et la carte des prix sont enregistrées immédiatement après téléversement.</p>
          {error && <p className="mt-3 rounded-lg bg-tone-danger-bg px-3 py-2 text-xs text-tone-danger-fg">{error}</p>}
          {saved && !error && <p className="mt-3 rounded-lg bg-tone-success-bg px-3 py-2 text-xs font-medium text-tone-success-fg">Modifications enregistrées.</p>}
          <Button type="button" onClick={onSave} loading={saving} className="mt-4 w-full">{saving ? 'Enregistrement…' : 'Enregistrer les modifications'}</Button>
        </section>
        <section className="rounded-xl border border-a-border bg-a-surface p-4"><h2 className="text-sm font-semibold text-a-text">État du contenu</h2><div className="mt-3 space-y-2 text-sm"><div className="flex justify-between gap-3"><span className="text-a-text-3">Bannière</span><strong className="text-a-text">{event.banner_image_url ? 'Configurée' : 'Non renseignée'}</strong></div><div className="flex justify-between gap-3"><span className="text-a-text-3">Tarifs sur place</span><strong className="text-a-text">{priceListImageUrl ? 'Configurés' : 'Non renseignés'}</strong></div><div className="flex justify-between gap-3"><span className="text-a-text-3">Sous-titre</span><strong className="text-a-text">{subtitle.trim() ? 'Configuré' : 'Optionnel'}</strong></div><div className="flex justify-between gap-3"><span className="text-a-text-3">Points forts</span><strong className="text-a-text">{highlights.length} / {maxHighlights}</strong></div></div></section>
      </aside>
    </div>
  );
}
