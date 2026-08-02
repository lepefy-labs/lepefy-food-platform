'use client';

import { useEffect, useRef } from 'react';

interface CategoryBlocksRowProps {
  /** Les blocs réels SUIVIS de leur copie décorative dupliquée (voir
   *  CategoryBlock `hiddenFromA11y`) — la duplication rend la boucle
   *  imperceptible : au moment où le scroll atteint le début de la copie
   *  (scrollWidth / 2), on retranche silencieusement la largeur d'un jeu
   *  complet. Les deux jeux sont concaténés par l'appelant (page.tsx). */
  children: React.ReactNode;
  /** Nombre de blocs réels — pilote la durée d'un tour complet. */
  itemCount: number;
}

/**
 * Scroll horizontal auto-continu des blocs-catégorie (Fix 3, cycle "fix home").
 *
 * Déviation documentée par rapport au ticker de layout.tsx : le ticker anime
 * un `transform: translateX` CSS sur une piste en `position: absolute`, sans
 * jamais être scrollable nativement. Ici la spec exige l'inverse — le
 * conteneur doit rester `overflow-x-auto` scrollable au doigt/à la souris à
 * tout moment, y compris pendant l'autoscroll, avec reprise après relâchement.
 * Un `transform` CSS animé sur un élément qui reçoit aussi du scroll natif
 * entrerait en conflit avec le geste de swipe du navigateur (les deux
 * pilotent la position visuelle par des mécanismes différents et
 * incompatibles). La seule façon fiable de faire cohabiter scroll natif +
 * autoscroll + drag manuel est de piloter `scrollLeft` en JS (rAF), ce qui
 * est fait ici — le principe du ticker (contenu dupliqué une fois, boucle
 * sans saut visible) est conservé à l'identique, seul le mécanisme de bas
 * niveau change.
 */
export function CategoryBlocksRow({ children, itemCount }: CategoryBlocksRowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const reducedMotionRef = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotionRef.current = mediaQuery.matches;
    function handleChange(e: MediaQueryListEvent) {
      reducedMotionRef.current = e.matches;
    }
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    // Vitesse dérivée du nombre de blocs (éléments larges, pas du texte du
    // ticker) : un tour complet dure itemCount * 5s, plancher 20s pour rester
    // lisible avec peu de catégories.
    const durationMs = Math.max(itemCount * 5, 20) * 1000;
    let lastTime: number | null = null;
    let rafId: number;

    function step(time: number) {
      if (lastTime === null) lastTime = time;
      const delta = time - lastTime;
      lastTime = time;

      if (track && !pausedRef.current && !reducedMotionRef.current) {
        // La moitié de scrollWidth = largeur d'un seul jeu (réel + copie
        // dupliquée de même taille) — boucle en retranchant cette moitié dès
        // qu'on l'atteint, invisible car la copie est identique à l'original.
        const halfWidth = track.scrollWidth / 2;
        if (halfWidth > 0) {
          const pxPerMs = halfWidth / durationMs;
          track.scrollLeft += pxPerMs * delta;
          if (track.scrollLeft >= halfWidth) {
            track.scrollLeft -= halfWidth;
          }
        }
      }
      rafId = requestAnimationFrame(step);
    }

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [itemCount]);

  function pause() { pausedRef.current = true; }
  function resume() { pausedRef.current = false; }

  return (
    <div
      ref={trackRef}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      onTouchStart={pause}
      onTouchEnd={resume}
      className="
        category-blocks-track flex gap-3 overflow-x-auto snap-x snap-mandatory px-4 pb-3 mt-5
        [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
      "
    >
      {children}
    </div>
  );
}
