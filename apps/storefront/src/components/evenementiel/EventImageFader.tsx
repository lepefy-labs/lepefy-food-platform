'use client';

import { useEffect, useState, type ReactNode } from 'react';

interface EventImageFaderProps {
  images: string[];
  fallbackColor: string;
  intervalMs?: number;
  className?: string;
  children?: ReactNode;
}

/**
 * Rotation auto-fade (crossfade) entre plusieurs images d'événement, sans
 * aucune interaction utilisateur (pas de swipe, pas de puces cliquables).
 *
 * Le fallback reste toujours peint derrière les images : ainsi une URL
 * distante invalide ou qui ne charge pas ne laisse jamais apparaître un
 * panneau transparent/illisible. Pour 0 image, le résultat reste simplement
 * la couleur de fallback. Pour 1 ou plusieurs images, celles-ci se peignent
 * par-dessus dès qu'elles sont effectivement disponibles.
 *
 * L'appelant peut fournir sa propre utility de positionnement (`absolute`,
 * `relative`, etc.). On n'ajoute `relative` que lorsqu'aucune position n'est
 * déjà présente afin d'éviter le conflit Tailwind qui faisait perdre
 * `absolute inset-0` au hero.
 */
export function EventImageFader({ images, fallbackColor, intervalMs = 5000, className = '', children }: EventImageFaderProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const hasPositionClass = /(^|\s)(static|fixed|absolute|relative|sticky)(\s|$)/.test(className);

  useEffect(() => {
    if (images.length <= 1) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const id = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % images.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [images.length, intervalMs]);

  return (
    <div
      className={`${hasPositionClass ? '' : 'relative '}overflow-hidden ${className}`}
      style={{ backgroundColor: fallbackColor }}
    >
      {images.length === 1 && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${images[0]})` }}
          aria-hidden="true"
        />
      )}

      {images.length > 1 && images.map((src, i) => (
        <div
          key={i}
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-1000"
          style={{ backgroundImage: `url(${src})`, opacity: i === activeIndex ? 1 : 0 }}
          aria-hidden="true"
        />
      ))}

      {children && <div className="relative z-10 h-full">{children}</div>}
    </div>
  );
}
