'use client';

import Image from 'next/image';
import Link from 'next/link';
import { IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ShopTag } from '@/components/ui/ShopTag';
import type { TenantHeroSlide } from '@lepefy/types';

export type HeroSlideKind = 'editorial' | 'offers' | 'new-arrivals' | 'event' | 'service';

export interface HeroSlideProduct {
  id: string;
  name: string;
  slug: string;
  image_url: string;
  price_label: string;
  compare_at_price_label?: string | null;
}

export interface HeroSlideData extends Pick<
  TenantHeroSlide,
  | 'id'
  | 'badge_text'
  | 'title'
  | 'subtitle'
  | 'cta_primary_label'
  | 'cta_primary_url'
  | 'cta_secondary_label'
  | 'cta_secondary_url'
  | 'image_url'
  | 'background_variant'
> {
  kind?: HeroSlideKind;
  meta?: string | null;
  products?: HeroSlideProduct[];
}

interface HeroCarouselProps {
  slides: HeroSlideData[];
}

const AUTOPLAY_MS = 6500;

export const VARIANT_BACKGROUND: Record<HeroSlideData['background_variant'], string> = {
  primary: 'linear-gradient(160deg, var(--color-primary), var(--color-primary-dark))',
  secondary: 'linear-gradient(160deg, var(--color-secondary), color-mix(in oklch, var(--color-secondary) 70%, black))',
  accent: 'linear-gradient(160deg, var(--color-primary-dark), black)',
};

function HeroTrianglePattern({ patternId }: { patternId: string }) {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id={patternId} width="11" height="9.5" patternUnits="userSpaceOnUse">
          <polygon points="5.5,0.5 10.5,9 0.5,9" fill="white" fillOpacity="0.5" />
        </pattern>
      </defs>
      <rect width="100" height="100" fill={`url(#${patternId})`} />
    </svg>
  );
}

function ProductVisual({ products }: { products: HeroSlideProduct[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 self-end sm:grid-cols-3 md:gap-3" aria-label="Produits mis en avant">
      {products.slice(0, 3).map((product, index) => (
        <Link
          key={product.id}
          href={`/products/${product.slug}`}
          className={`group overflow-hidden rounded-xl border border-white/35 bg-white/95 p-1.5 shadow-xl backdrop-blur-sm transition-transform hover:-translate-y-1 md:p-2 ${index === 1 ? '-translate-y-3' : ''} ${index === 2 ? 'hidden sm:block' : ''}`}
        >
          <div className="relative aspect-square overflow-hidden rounded-lg bg-white">
            <Image src={product.image_url} alt={product.name} fill sizes="(max-width: 768px) 28vw, 180px" className="object-contain" />
          </div>
          <p className="mt-1.5 line-clamp-1 text-[10px] font-bold text-gray-900 md:text-xs">{product.name}</p>
          <div className="flex flex-wrap items-baseline gap-1">
            <span className="text-[11px] font-extrabold text-[var(--color-primary-dark)] md:text-sm">{product.price_label}</span>
            {product.compare_at_price_label && <span className="text-[9px] text-gray-400 line-through md:text-[10px]">{product.compare_at_price_label}</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}

export function HeroCarousel({ slides }: HeroCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const handleScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const children = Array.from(track.children) as HTMLElement[];
    let closest = 0;
    let minDist = Infinity;
    children.forEach((child, index) => {
      const dist = Math.abs(child.offsetLeft - track.offsetLeft - track.scrollLeft);
      if (dist < minDist) {
        minDist = dist;
        closest = index;
      }
    });
    setActiveIndex(closest);
  }, []);

  const goToSlide = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    const track = trackRef.current;
    const child = track?.children[index] as HTMLElement | undefined;
    if (!track || !child) return;
    track.scrollTo({ left: child.offsetLeft - track.offsetLeft, behavior });
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.addEventListener('scroll', handleScroll, { passive: true });
    return () => track.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    if (slides.length < 2 || hoverPaused || userPaused || reduceMotion) return;
    const timer = window.setTimeout(() => goToSlide((activeIndex + 1) % slides.length), AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeIndex, goToSlide, hoverPaused, reduceMotion, slides.length, userPaused]);

  if (slides.length === 0) return null;

  return (
    <div
      className="relative"
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
      onFocusCapture={() => setHoverPaused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHoverPaused(false);
      }}
    >
      <div
        ref={trackRef}
        role="region"
        aria-roledescription="carousel"
        aria-label="Mises en avant"
        onPointerDown={(event) => { if (event.pointerType !== 'mouse') setHoverPaused(true); }}
        onPointerUp={(event) => { if (event.pointerType !== 'mouse') setHoverPaused(false); }}
        onPointerCancel={(event) => { if (event.pointerType !== 'mouse') setHoverPaused(false); }}
        className="flex gap-3 overflow-x-auto snap-x snap-mandatory px-4 pt-4 pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:gap-0 md:px-0 md:pt-0 md:pb-0"
      >
        {slides.map((slide, index) => {
          const hasProducts = Boolean(slide.products?.length);
          return (
            <article
              key={slide.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} sur ${slides.length}`}
              className="relative min-h-[430px] flex-[0_0_88%] snap-center overflow-hidden rounded-2xl md:min-h-[460px] md:flex-[0_0_100%] md:rounded-none md:snap-start"
              style={{ backgroundImage: VARIANT_BACKGROUND[slide.background_variant] }}
            >
              {slide.image_url && (
                <Image src={slide.image_url} alt="" fill priority={index === 0} sizes="100vw" className="object-cover object-center md:object-[65%_center]" />
              )}
              {slide.image_url && <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,.82)_0%,rgba(0,0,0,.64)_42%,rgba(0,0,0,.22)_75%,rgba(0,0,0,.12)_100%)]" aria-hidden="true" />}
              {!slide.image_url && slide.background_variant === 'primary' && (
                <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
                  <div className="absolute -right-16 -top-20 h-[300px] w-[300px] overflow-hidden rounded-full opacity-40">
                    <HeroTrianglePattern patternId={`heroTriangles-${slide.id}`} />
                  </div>
                </div>
              )}

              <div className={`relative z-10 mx-auto grid min-h-[430px] max-w-6xl items-center gap-7 px-6 py-9 md:min-h-[460px] md:px-10 md:py-12 ${hasProducts ? 'md:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]' : ''}`}>
                <div>
                  {slide.badge_text && <ShopTag className="mb-3">{slide.badge_text}</ShopTag>}
                  <h2 className="max-w-[22ch] font-display text-3xl font-bold leading-[1.05] text-white md:text-5xl">{slide.title}</h2>
                  {slide.subtitle && <p className="mt-3 max-w-[42ch] line-clamp-3 text-sm leading-relaxed text-white md:text-base">{slide.subtitle}</p>}
                  {slide.meta && <p className="mt-3 text-xs font-bold uppercase tracking-[.12em] text-[var(--color-secondary)]">{slide.meta}</p>}
                  <div className="mt-6 flex flex-wrap gap-2.5">
                    {slide.cta_primary_label && slide.cta_primary_url && (
                      <Link href={slide.cta_primary_url} className="inline-flex min-h-11 items-center rounded-full bg-white px-5 py-3 text-sm font-bold text-[var(--color-primary-dark)] transition-transform hover:-translate-y-0.5">
                        {slide.cta_primary_label}
                      </Link>
                    )}
                    {slide.cta_secondary_label && slide.cta_secondary_url && (
                      <Link href={slide.cta_secondary_url} className="inline-flex min-h-11 items-center rounded-full border border-white/60 bg-white/5 px-5 py-3 text-sm font-semibold text-white backdrop-blur-sm hover:bg-white/10">
                        {slide.cta_secondary_label}
                      </Link>
                    )}
                  </div>
                </div>
                {slide.products && slide.products.length > 0 && <ProductVisual products={slide.products} />}
              </div>
            </article>
          );
        })}
      </div>

      {slides.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1.5" role="group" aria-label="Commandes du carrousel">
          {slides.map((slide, index) => (
            <button key={slide.id} type="button" onClick={() => goToSlide(index, reduceMotion ? 'auto' : 'smooth')} aria-current={index === activeIndex ? 'true' : undefined} aria-label={`Afficher la diapositive ${index + 1}`} className="p-2 -m-2">
              <span className="block h-2 rounded-full transition-all" style={{ width: index === activeIndex ? 20 : 8, backgroundColor: index === activeIndex ? 'var(--color-primary)' : '#d1d5db' }} />
            </button>
          ))}
          {!reduceMotion && (
            <button type="button" onClick={() => setUserPaused((paused) => !paused)} className="ml-2 inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-100" aria-label={userPaused ? 'Relancer le défilement automatique' : 'Suspendre le défilement automatique'}>
              {userPaused ? <IconPlayerPlay size={15} /> : <IconPlayerPause size={15} />}
              {userPaused ? 'Lire' : 'Pause'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
