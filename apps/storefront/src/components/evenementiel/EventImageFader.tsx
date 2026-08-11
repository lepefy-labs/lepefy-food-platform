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
 * `images.length` pilote le rendu : 0 → couleur unie, 1 → image statique
 * (pas de setInterval), >1 → stack crossfade — comportement identique à
 * l'ancien `banner_image_url` unique pour les deux premiers cas.
 *
 * Dimensions toujours fournies par l'appelant via `className` (jamais de
 * vh/dvh ni de hauteur calculée en JS ici) pour rester cross-device par
 * construction, comme le reste du projet.
 */
export function EventImageFader({ images, fallbackColor, intervalMs = 5000, className = '', children }: EventImageFaderProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (images.length <= 1) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const id = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % images.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [images.length, intervalMs]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {images.length === 0 && (
        <div className="absolute inset-0" style={{ backgroundColor: fallbackColor }} aria-hidden="true" />
      )}

      {images.length === 1 && (
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${images[0]})` }} aria-hidden="true" />
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
