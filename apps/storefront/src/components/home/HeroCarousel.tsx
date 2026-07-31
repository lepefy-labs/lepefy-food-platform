'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ShopTag } from '@/components/ui/ShopTag';
import type { TenantHeroSlide } from '@lepefy/types';

export type HeroSlideData = Pick<
  TenantHeroSlide,
  | 'id'
  | 'badge_text'
  | 'title'
  | 'subtitle'
  | 'cta_primary_label'
  | 'cta_primary_url'
  | 'cta_secondary_label'
  | 'cta_secondary_url'
  | 'background_variant'
>;

interface HeroCarouselProps {
  slides: HeroSlideData[];
}

// Gradients dérivés des tokens réels du tenant — jamais un hex nouveau.
// `accent` sert aux slides à fort contraste (ex. promo) : primary-dark → noir.
// Exporté pour être réutilisé tel quel par l'aperçu live de l'admin
// (accueil-slides) — une seule source de vérité pour ce mapping.
export const VARIANT_BACKGROUND: Record<HeroSlideData['background_variant'], string> = {
  primary:   'linear-gradient(160deg, var(--color-primary), var(--color-primary-dark))',
  secondary: 'linear-gradient(160deg, var(--color-secondary), color-mix(in oklch, var(--color-secondary) 70%, black))',
  accent:    'linear-gradient(160deg, var(--color-primary-dark), black)',
};

/** Pattern décoratif "anneau tribal" repris tel quel de l'ancien hero fixe —
 *  décision de plateforme, pas un asset spécifique à un tenant. Réservé à la
 *  variante `primary` (voir spec Feature 1) pour éviter tout conflit visuel
 *  avec les autres gradients. */
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

/**
 * Hero carousel multi-slide — remplace l'ancien hero fixe (Feature 1, cycle
 * redesign home). Scroll natif horizontal avec scroll-snap, aucun autoplay
 * (accessibilité — swipe/tap manuel uniquement), dots synchronisés au scroll.
 * Sur desktop chaque slide occupe toute la largeur du conteneur (le défilement
 * horizontal perd son sens sur un grand écran) ; les dots restent le moyen de
 * navigation, le geste trackpad horizontal fonctionne toujours nativement.
 */
export function HeroCarousel({ slides }: HeroCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const children = Array.from(track.children) as HTMLElement[];
    let closest = 0;
    let minDist = Infinity;
    children.forEach((child, i) => {
      const dist = Math.abs(child.offsetLeft - track.scrollLeft);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    });
    setActiveIndex(closest);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.addEventListener('scroll', handleScroll, { passive: true });
    return () => track.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  function goToSlide(index: number) {
    const track = trackRef.current;
    const child = track?.children[index] as HTMLElement | undefined;
    if (!track || !child) return;
    track.scrollTo({ left: child.offsetLeft - track.offsetLeft, behavior: 'smooth' });
  }

  if (slides.length === 0) return null;

  return (
    <div className="relative">
      <div
        ref={trackRef}
        role="region"
        aria-roledescription="carousel"
        aria-label="Mises en avant"
        className="
          flex gap-3 overflow-x-auto snap-x snap-mandatory px-4 pt-4 pb-1
          [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
          md:px-0 md:pt-0 md:pb-0 md:gap-0
        "
      >
        {slides.map((slide) => (
          <div
            key={slide.id}
            className="relative flex-[0_0_88%] snap-center rounded-2xl overflow-hidden md:flex-[0_0_100%] md:rounded-none md:snap-none"
            style={{ backgroundImage: VARIANT_BACKGROUND[slide.background_variant] }}
          >
            {slide.background_variant === 'primary' && (
              <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
                <div
                  className="absolute rounded-full overflow-hidden"
                  style={{ width: 260, height: 260, top: -90, right: -70, opacity: 0.5 }}
                >
                  <HeroTrianglePattern patternId={`heroTriangles-${slide.id}`} />
                </div>
              </div>
            )}

            <div className="relative z-10 px-6 py-10 md:px-10 md:py-14 md:max-w-6xl md:mx-auto">
              {slide.badge_text && <ShopTag className="mb-3">{slide.badge_text}</ShopTag>}
              {/* h2, pas h1 : toutes les slides sont présentes dans le DOM en
                  même temps (scroll horizontal), un seul h1 par page reste
                  correct sémantiquement. */}
              <h2 className="font-display text-white font-bold leading-tight text-2xl md:text-4xl max-w-[24ch]">
                {slide.title}
              </h2>
              {slide.subtitle && (
                <p className="mt-2 text-white/85 leading-snug text-sm max-w-[38ch]">{slide.subtitle}</p>
              )}
              <div className="flex flex-wrap gap-2.5 mt-5">
                {slide.cta_primary_label && slide.cta_primary_url && (
                  <Link
                    href={slide.cta_primary_url}
                    className="inline-flex items-center gap-1.5 bg-white rounded-md px-5 py-3 text-sm font-bold transition-transform hover:scale-105"
                    style={{ color: 'var(--color-primary-dark)' }}
                  >
                    {slide.cta_primary_label}
                  </Link>
                )}
                {slide.cta_secondary_label && slide.cta_secondary_url && (
                  <Link
                    href={slide.cta_secondary_url}
                    className="inline-flex items-center gap-1.5 rounded-md px-5 py-3 text-sm font-semibold text-white border-2 border-white/45 transition-colors hover:border-white/70"
                  >
                    {slide.cta_secondary_label}
                  </Link>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {slides.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-3" role="tablist" aria-label="Diapositives">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => goToSlide(i)}
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={`Diapositive ${i + 1}`}
              className="p-2 -m-2"
            >
              <span
                className="block h-2 rounded-full transition-all"
                style={{
                  width: i === activeIndex ? 20 : 8,
                  backgroundColor: i === activeIndex ? 'var(--color-primary)' : '#d1d5db',
                }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
