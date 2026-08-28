'use client';

import { useEffect, useRef, useState } from 'react';
import { IconArrowUpRight, IconCash, IconPhoto, IconX } from '@tabler/icons-react';

export default function EventOnSitePriceList({ imageUrl }: { imageUrl: string }) {
  const [open, setOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      <section className="mb-5 overflow-hidden rounded-[22px] border border-black/[0.07] bg-white shadow-[0_10px_28px_rgba(50,37,20,.06)] sm:mb-6">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--color-primary)_11%,white)] text-[var(--color-primary)]">
              <IconPhoto size={22} stroke={1.8} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl font-semibold text-gray-900">Tarifs sur place</h2>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                  <IconCash size={12} /> Paiement sur place
                </span>
              </div>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-gray-500">Découvrez les plats et boissons disponibles le jour de l’événement. Ces tarifs sont distincts des formules réservables en ligne.</p>
            </div>
          </div>
          <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[var(--color-primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2">
            Voir la carte des prix <IconArrowUpRight size={16} />
          </button>
        </div>
      </section>

      {open && (
        <div className="fixed inset-0 z-[90] flex flex-col bg-black/92" role="dialog" aria-modal="true" aria-label="Tarifs sur place" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-black/45 px-4 py-3 text-white backdrop-blur-sm sm:px-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">Événement</p>
              <h2 className="text-base font-bold sm:text-lg">Tarifs sur place</h2>
            </div>
            <button ref={closeButtonRef} type="button" onClick={() => setOpen(false)} className="grid size-11 shrink-0 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white" aria-label="Fermer la carte des prix"><IconX size={22} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2 sm:p-5">
            <div className="mx-auto flex min-h-full max-w-5xl items-start justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="Carte des tarifs des plats et boissons vendus sur place" className="h-auto w-auto max-w-full rounded-lg bg-white object-contain shadow-2xl sm:max-h-[calc(100vh-8rem)]" />
            </div>
          </div>
          <div className="shrink-0 border-t border-white/10 bg-black/55 px-4 py-3 text-center backdrop-blur-sm">
            <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">Ouvrir l’image pour zoomer <IconArrowUpRight size={15} /></a>
          </div>
        </div>
      )}
    </>
  );
}
