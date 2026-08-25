'use client';

import { useMemo, useState } from 'react';
import { IconCheck, IconDownload, IconPhoto, IconShare3, IconX } from '@tabler/icons-react';

interface SocialPhoto {
  id: string;
  imageUrl: string;
  caption: string | null;
}

interface EventSocialShareProps {
  eventSlug: string;
  eventTitle: string;
  photos: SocialPhoto[];
}

export default function EventSocialShare({ eventSlug, eventTitle, photos }: EventSocialShareProps) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(photos[0]?.id ?? '');
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selected = useMemo(() => photos.find((photo) => photo.id === selectedId) ?? photos[0], [photos, selectedId]);
  if (!selected) return null;

  const cardUrl = `/api/evenementiel/events/${encodeURIComponent(eventSlug)}/social-card?photo=${encodeURIComponent(selected.id)}`;

  async function shareCard() {
    setMessage(null);
    setSharing(true);
    try {
      const response = await fetch(cardUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error('card-generation-failed');
      const blob = await response.blob();
      const file = new File([blob], `${eventSlug}-story.png`, { type: 'image/png' });
      const eventUrl = window.location.href;
      const canShareFiles = typeof navigator.share === 'function'
        && typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [file] });

      if (canShareFiles) {
        await navigator.share({
          files: [file],
          title: eventTitle,
          text: `${eventTitle} — ${eventUrl}`,
        });
        setMessage('Prêt à publier dans l’app de votre choix.');
        return;
      }

      if (typeof navigator.share === 'function') {
        await navigator.share({ title: eventTitle, text: eventTitle, url: eventUrl });
        setMessage('Le lien a été partagé. Téléchargez aussi la story si vous souhaitez publier l’image.');
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
      try {
        await navigator.clipboard.writeText(eventUrl);
        setMessage('Story téléchargée et lien copié. Ouvrez votre app sociale pour publier.');
      } catch {
        setMessage('Story téléchargée. Ouvrez votre app sociale pour publier.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage('Impossible de préparer le partage pour le moment. Réessayez.');
    } finally {
      setSharing(false);
    }
  }

  return (
    <>
      <section className="rounded-[22px] border border-black/[0.06] bg-white p-4 shadow-sm sm:flex sm:items-center sm:justify-between sm:gap-5 sm:p-5">
        <div className="flex gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] text-[var(--color-primary)]">
            <IconShare3 size={21} />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Partagez l’événement avec vos proches</p>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-gray-500">
              Choisissez votre photo, puis publiez une story prête pour WhatsApp, Instagram, TikTok ou toute autre app disponible sur votre téléphone.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setOpen(true); setMessage(null); }}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--color-primary)_28%,white)] bg-[color-mix(in_srgb,var(--color-primary)_8%,white)] px-4 text-sm font-bold text-[var(--color-primary)] transition hover:bg-[color-mix(in_srgb,var(--color-primary)_13%,white)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:mt-0 sm:w-auto"
        >
          <IconShare3 size={17} /> Partager
        </button>
      </section>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Partager cet événement">
          <button type="button" className="absolute inset-0" aria-label="Fermer" onClick={() => setOpen(false)} />
          <div className="relative z-[1] max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-[28px] bg-[#f7f3eb] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-[28px] sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--color-primary)]">Story prête à publier</p>
                <h2 className="mt-1 font-display text-2xl font-semibold text-gray-900">Choisissez votre photo</h2>
                <p className="mt-1 text-xs text-gray-500">Le format final est vertical 9:16 avec les informations essentielles de l’événement.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fermer" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
                <IconX size={18} />
              </button>
            </div>

            <div className="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-gray-700"><IconPhoto size={15} /> Photos approuvées</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((photo) => {
                    const active = photo.id === selected.id;
                    return (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => setSelectedId(photo.id)}
                        aria-pressed={active}
                        className={`relative aspect-[4/5] overflow-hidden rounded-xl border-2 bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${active ? 'border-[var(--color-primary)]' : 'border-transparent'}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.imageUrl} alt={photo.caption ?? 'Photo de l’événement'} className="h-full w-full object-cover" />
                        {active && <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-[var(--color-primary)] text-white shadow"><IconCheck size={14} /></span>}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 rounded-xl bg-white/70 p-3 text-[11px] leading-relaxed text-gray-500">
                  Sur mobile, le bouton ci-dessous ouvre la feuille de partage du système : les apps proposées dépendent de celles réellement installées sur votre appareil.
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold text-gray-700">Aperçu 9:16</p>
                <div className="mx-auto aspect-[9/16] w-full max-w-[250px] overflow-hidden rounded-2xl bg-gray-900 shadow-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img key={cardUrl} src={cardUrl} alt={`Story ${eventTitle}`} className="h-full w-full object-cover" />
                </div>
              </div>
            </div>

            {message && <p role="status" className="mt-4 rounded-xl bg-white px-3 py-2 text-xs text-gray-600">{message}</p>}

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <a href={cardUrl} download={`${eventSlug}-story.png`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
                <IconDownload size={17} /> Télécharger
              </a>
              <button type="button" onClick={shareCard} disabled={sharing} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--color-primary-dark)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2">
                <IconShare3 size={17} /> {sharing ? 'Préparation…' : 'Partager la story'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
