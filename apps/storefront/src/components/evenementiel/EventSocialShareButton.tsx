'use client';

import { useMemo, useState } from 'react';
import { IconCheck, IconDownload, IconShare3, IconX } from '@tabler/icons-react';

export interface EventSocialPhoto {
  id: string;
  imageUrl: string;
  caption: string | null;
}

interface EventSocialShareButtonProps {
  eventSlug: string;
  eventTitle: string;
  photos: EventSocialPhoto[];
  className?: string;
}

export default function EventSocialShareButton({
  eventSlug,
  eventTitle,
  photos,
  className = '',
}: EventSocialShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(photos[0]?.id ?? '');
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => photos.find((photo) => photo.id === selectedId) ?? photos[0],
    [photos, selectedId],
  );

  if (!selected) return null;

  const cardUrl = `/api/evenementiel/events/${encodeURIComponent(eventSlug)}/social-card?photo=${encodeURIComponent(selected.id)}`;

  async function shareCard() {
    setError(null);
    setSharing(true);
    try {
      const response = await fetch(cardUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error('card-generation-failed');

      const blob = await response.blob();
      const file = new File([blob], `${eventSlug}-story.png`, { type: 'image/png' });
      const eventUrl = new URL(`/evenementiel/evenements/${eventSlug}`, window.location.origin).toString();
      const canShareFiles = typeof navigator.share === 'function'
        && typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [file] });

      if (canShareFiles) {
        await navigator.share({ files: [file], title: eventTitle, text: `${eventTitle} — ${eventUrl}` });
        return;
      }

      if (typeof navigator.share === 'function') {
        await navigator.share({ title: eventTitle, url: eventUrl });
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `${eventSlug}-story.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      try { await navigator.clipboard.writeText(eventUrl); } catch { /* no-op */ }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
      setError('Impossible de partager pour le moment.');
    } finally {
      setSharing(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Partager ${eventTitle}`}
        title="Partager"
        onClick={() => { setOpen(true); setError(null); }}
        className={`flex size-11 items-center justify-center rounded-full border border-white/55 bg-white/92 text-gray-800 shadow-lg backdrop-blur transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${className}`}
      >
        <IconShare3 size={19} stroke={2} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Partager">
          <button type="button" className="absolute inset-0" aria-label="Fermer" onClick={() => setOpen(false)} />
          <div className="relative z-[1] max-h-[94dvh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-[#f7f3eb] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[28px] sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-2xl font-semibold text-gray-900">Partager</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="flex size-10 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
                <IconX size={18} />
              </button>
            </div>

            <div className={`mt-4 grid gap-4 ${photos.length > 1 ? 'md:grid-cols-[minmax(0,1fr)_240px]' : ''}`}>
              {photos.length > 1 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:auto-rows-min">
                  {photos.map((photo) => {
                    const active = photo.id === selected.id;
                    return (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => setSelectedId(photo.id)}
                        aria-label="Choisir cette photo"
                        aria-pressed={active}
                        className={`relative aspect-[4/5] overflow-hidden rounded-xl border-2 bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${active ? 'border-[var(--color-primary)]' : 'border-transparent'}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.imageUrl} alt={photo.caption ?? ''} className="h-full w-full object-cover" />
                        {active && <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-[var(--color-primary)] text-white shadow"><IconCheck size={14} /></span>}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="mx-auto w-full max-w-[250px]">
                <div className="aspect-[9/16] overflow-hidden rounded-2xl bg-gray-900 shadow-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img key={cardUrl} src={cardUrl} alt={`Story ${eventTitle}`} className="h-full w-full object-cover" />
                </div>
              </div>
            </div>

            {error && <p role="alert" className="mt-3 text-center text-xs font-medium text-red-600">{error}</p>}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <a href={cardUrl} download={`${eventSlug}-story.png`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
                <IconDownload size={17} /> Télécharger
              </a>
              <button type="button" onClick={shareCard} disabled={sharing} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-3 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--color-primary-dark)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2">
                <IconShare3 size={17} /> {sharing ? '…' : 'Partager'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
