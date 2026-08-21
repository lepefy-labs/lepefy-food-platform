'use client';

import { useEffect, useRef, useState } from 'react';
import { CategoryBlock } from '@/components/home/CategoryBlock';
import { useCatalogMotionPreferences } from './useCatalogMotionPreferences';
import type { Category } from '@lepefy/types';

interface CatalogCategoryRowProps {
  categories: Category[];
  previewImagesByCategory: Record<string, string[]>;
  activeSlug?: string;
  onSelect: (slug: string | null) => void;
}

export function CatalogCategoryRow({ categories, previewImagesByCategory, activeSlug, onSelect }: CatalogCategoryRowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const focusWithinRef = useRef(false);
  const automaticScrollRef = useRef(false);
  const automaticScrollTimeoutRef = useRef<number | null>(null);
  const resumeTimeoutRef = useRef<number | null>(null);
  const [paused, setPaused] = useState(false);
  const { isDesktop, reducedMotion } = useCatalogMotionPreferences();

  function clearResumeTimeout() {
    if (resumeTimeoutRef.current !== null) window.clearTimeout(resumeTimeoutRef.current);
    resumeTimeoutRef.current = null;
  }

  function pauseForInteraction(resumeLater = true) {
    setPaused(true);
    clearResumeTimeout();
    if (resumeLater) {
      resumeTimeoutRef.current = window.setTimeout(() => {
        if (!focusWithinRef.current) setPaused(false);
      }, 10000);
    }
  }

  useEffect(() => {
    if (isDesktop || reducedMotion || paused) return;
    const interval = window.setInterval(() => {
      const track = trackRef.current;
      if (!track || track.children.length < 2 || track.scrollWidth <= track.clientWidth) return;
      const cards = Array.from(track.children) as HTMLElement[];
      const currentIndex = cards.reduce((nearest, card, index) => {
        const currentDistance = Math.abs(cards[nearest]!.offsetLeft - track.offsetLeft - track.scrollLeft);
        const candidateDistance = Math.abs(card.offsetLeft - track.offsetLeft - track.scrollLeft);
        return candidateDistance < currentDistance ? index : nearest;
      }, 0);
      const isAtEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
      const nextIndex = isAtEnd ? 0 : (currentIndex + 1) % cards.length;
      automaticScrollRef.current = true;
      track.scrollTo({
        left: nextIndex === 0 ? 0 : cards[nextIndex]!.offsetLeft - track.offsetLeft,
        behavior: 'smooth',
      });
      if (automaticScrollTimeoutRef.current !== null) window.clearTimeout(automaticScrollTimeoutRef.current);
      automaticScrollTimeoutRef.current = window.setTimeout(() => {
        automaticScrollRef.current = false;
      }, 1000);
    }, 3500);
    return () => window.clearInterval(interval);
  }, [isDesktop, paused, reducedMotion]);

  useEffect(() => () => {
    clearResumeTimeout();
    if (automaticScrollTimeoutRef.current !== null) window.clearTimeout(automaticScrollTimeoutRef.current);
  }, []);

  return (
    <section aria-labelledby="catalog-univers-heading" className="mt-4 md:mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="catalog-univers-heading" className="font-display text-lg font-bold text-gray-900">Nos univers</h2>
        {activeSlug && (
          <button type="button" onClick={() => onSelect(null)} className="rounded-md px-2 py-1 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2" style={{ color: 'var(--color-primary)', '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties}>
            Tout voir
          </button>
        )}
      </div>
      <div
        ref={trackRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-0.5 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-4 md:overflow-visible md:snap-none md:pb-0 lg:grid-cols-6"
        aria-label="Catégories de produits"
        onPointerDown={() => pauseForInteraction()}
        onWheel={() => pauseForInteraction()}
        onScroll={() => { if (!automaticScrollRef.current) pauseForInteraction(); }}
        onFocusCapture={() => {
          focusWithinRef.current = true;
          pauseForInteraction(false);
        }}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            focusWithinRef.current = false;
            pauseForInteraction();
          }
        }}
      >
        {categories.map((category, index) => (
          <CategoryBlock key={category.id} variant="catalog" index={index} name={category.name} slug={category.slug} count={0} products={[]} imageUrl={category.image_url} previewImages={previewImagesByCategory[category.id] ?? []} animatePreviewImages={!isDesktop && !reducedMotion} primaryColor="var(--color-primary)" secondaryColor="var(--color-secondary)" active={activeSlug === category.slug} onSelect={() => onSelect(category.slug)} />
        ))}
      </div>
    </section>
  );
}
