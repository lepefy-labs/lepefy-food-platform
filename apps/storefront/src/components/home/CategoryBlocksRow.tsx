'use client';

import { useEffect, useRef } from 'react';

interface CategoryBlocksRowProps {
  /** Les blocs réels SUIVIS de leur copie décorative dupliquée (voir
   *  CategoryBlock `hiddenFromA11y`) — la duplication rend la boucle
   *  imperceptible : au moment où le scroll atteint le début de la copie
   *  (offsetLeft du (itemCount+1)-ième enfant), on retranche silencieusement
   *  la largeur d'un jeu complet. Les deux jeux sont concaténés par
   *  l'appelant (page.tsx). */
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
 *
 * Fix "autoscroll ne bouge pas" (cycle suivant) : le conteneur avait
 * `scroll-snap-type: x mandatory`. Chaque `scrollLeft +=` programmatique
 * n'est pas reconnu comme un geste de scroll natif par le moteur de snap, qui
 * le traite comme un saut discret et réaligne immédiatement sur le point de
 * snap courant — annulant le micro-déplacement de chaque frame avant qu'il
 * ne s'accumule visuellement. Le drag manuel (vrai geste tactile) n'est pas
 * affecté, d'où "le scroll manuel marche, l'auto ne bouge pas". Retiré ici ;
 * `scroll-snap-align` sur CategoryBlock reste dans le JSX mais devient un
 * no-op sans `scroll-snap-type` sur l'ancêtre (inoffensif, pas besoin d'y
 * toucher).
 *
 * Scoping mobile-only (< md, 768px, même breakpoint Tailwind par défaut que
 * partout ailleurs dans le projet — BottomNav, HeroCarousel, etc.) via
 * `md:hidden` en CSS plutôt que `matchMedia` en JS : évite un flash de
 * mauvais layout au premier rendu. Conséquence acceptée : la boucle rAF
 * continue de tourner même quand ce conteneur est masqué sur desktop (coût
 * négligeable, un simple `scrollLeft +=` sur un élément non affiché) — voir
 * CategoryBlocksGrid pour la version desktop, statique, sans scroll ni copie
 * dupliquée.
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
        // Largeur exacte d'un jeu complet = position de départ de la copie
        // dupliquée (le enfant d'index `itemCount`, premier élément dupliqué).
        // scrollWidth / 2 est FAUX ici : avec 2N enfants dans une même ligne
        // flex à gap uniforme, il y a 2N-1 gaps au total, pas 2N — la moitié
        // de scrollWidth dépasse donc la largeur réelle d'un jeu d'un demi-gap,
        // ce qui décale le point de bouclage (glitch visible au raccord).
        // `offsetLeft` du premier duplicata inclut tous les gaps réels et
        // reste correct quel que soit le gap CSS, sans le recalculer à la main.
        const firstDuplicate = track.children[itemCount] as HTMLElement | undefined;
        const wrapWidth = firstDuplicate ? firstDuplicate.offsetLeft : track.scrollWidth / 2;
        if (wrapWidth > 0) {
          const pxPerMs = wrapWidth / durationMs;
          track.scrollLeft += pxPerMs * delta;
          if (track.scrollLeft >= wrapWidth) {
            track.scrollLeft -= wrapWidth;
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
        category-blocks-track flex gap-3 overflow-x-auto px-4 pb-3 mt-5 bg-[#f7f9f8] md:hidden
        [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
      "
    >
      {children}
    </div>
  );
}
