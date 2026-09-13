'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import {
  IconChevronLeft,
  IconChevronRight,
  IconX,
  IconZoomIn,
} from '@tabler/icons-react';
import { ShopTag } from '@/components/ui/ShopTag';
import { normalizeProductImages } from '@/lib/catalog/productImages';
import type { ProductImage } from '@lepefy/types';

interface ProductGalleryProps {
  name: string;
  imageUrl: string | null;
  images: ProductImage[];
  isHomemade: boolean;
}

export function ProductGallery({ name, imageUrl, images, isHomemade }: ProductGalleryProps) {
  const gallery = useMemo(
    () => normalizeProductImages(images, imageUrl, name),
    [imageUrl, images, name],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  const active = gallery[activeIndex] ?? gallery[0] ?? null;

  useEffect(() => {
    if (activeIndex >= gallery.length) setActiveIndex(0);
  }, [activeIndex, gallery.length]);

  const showPrevious = useCallback(() => {
    setActiveIndex((current) => (current - 1 + gallery.length) % gallery.length);
  }, [gallery.length]);

  const showNext = useCallback(() => {
    setActiveIndex((current) => (current + 1) % gallery.length);
  }, [gallery.length]);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!lightboxOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeLightbox();
      if (event.key === 'ArrowLeft' && gallery.length > 1) showPrevious();
      if (event.key === 'ArrowRight' && gallery.length > 1) showNext();

      if (event.key === 'Tab') {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>('[data-product-lightbox-control]'),
        ).filter((element) => !element.hasAttribute('disabled'));
        if (controls.length === 0) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeLightbox, gallery.length, lightboxOpen, showNext, showPrevious]);

  function handleTouchEnd(event: React.TouchEvent) {
    if (touchStartX.current == null || gallery.length < 2) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const delta = touch.clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 48) return;
    if (delta > 0) showPrevious();
    else showNext();
  }

  return (
    <div className="flex flex-col gap-3 md:grid md:grid-cols-[5.5rem_minmax(0,1fr)] md:items-start">
      {gallery.length > 1 && (
        <div
          className="order-2 flex gap-3 overflow-x-auto pb-1 md:order-1 md:flex-col md:overflow-visible"
          aria-label="Images du produit"
        >
          {gallery.map((image, index) => (
            <button
              key={image.url}
              type="button"
              onClick={() => setActiveIndex(index)}
              aria-label={'Afficher l’image ' + (index + 1)}
              aria-current={index === activeIndex}
              className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border-2 bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 md:h-auto md:w-full md:aspect-square"
              style={{ borderColor: index === activeIndex ? 'var(--color-primary)' : 'transparent' }}
            >
              <Image
                src={image.url}
                alt=""
                fill
                className="object-cover"
                sizes="88px"
              />
            </button>
          ))}
        </div>
      )}

      <div className={(gallery.length > 1 ? 'order-1 md:order-2 ' : 'md:col-span-2 ') + 'min-w-0'}>
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-gray-100">
          {active ? (
            <>
              <button
                ref={triggerRef}
                type="button"
                onClick={() => setLightboxOpen(true)}
                className="group absolute inset-0 z-[1] cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--color-primary)]"
                aria-label="Agrandir l’image du produit"
              >
                <Image
                  src={active.url}
                  alt={active.alt || name}
                  fill
                  className="object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
                  sizes="(max-width: 768px) 100vw, 50vw"
                  priority
                />
                <span className="absolute bottom-3 right-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-white/95 px-3 text-sm font-medium text-gray-800 shadow-sm">
                  <IconZoomIn size={18} aria-hidden="true" />
                  Agrandir
                </span>
              </button>
              {isHomemade && (
                <ShopTag className="absolute left-4 top-4 z-10">Fait maison</ShopTag>
              )}
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-200">
              <svg className="h-24 w-24" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {lightboxOpen && active && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 md:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={'Galerie agrandie de ' + name}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeLightbox();
          }}
          onTouchStart={(event) => {
            touchStartX.current = event.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={handleTouchEnd}
        >
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeLightbox}
            data-product-lightbox-control
            className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white"
            aria-label="Fermer la galerie"
          >
            <IconX size={24} aria-hidden="true" />
          </button>

          {gallery.length > 1 && (
            <button
              type="button"
              onClick={showPrevious}
              data-product-lightbox-control
              className="absolute left-3 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white md:left-6"
              aria-label="Image précédente"
            >
              <IconChevronLeft size={28} aria-hidden="true" />
            </button>
          )}

          <div className="relative h-[82vh] w-[86vw] max-w-6xl">
            <Image
              src={active.url}
              alt={active.alt || name}
              fill
              className="select-none object-contain"
              sizes="100vw"
              priority
            />
          </div>

          {gallery.length > 1 && (
            <button
              type="button"
              onClick={showNext}
              data-product-lightbox-control
              className="absolute right-3 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 focus:outline-none focus:ring-2 focus:ring-white md:right-6"
              aria-label="Image suivante"
            >
              <IconChevronRight size={28} aria-hidden="true" />
            </button>
          )}

          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1.5 text-sm font-medium text-white" aria-live="polite">
            {activeIndex + 1} / {gallery.length}
          </span>
        </div>,
        document.body,
      )}
    </div>
  );
}
