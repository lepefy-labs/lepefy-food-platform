'use client';

import { useEffect, useState } from 'react';

const phrases = ['POUR VOUS', 'AVEC VOUS', 'QUI RASSEMBLENT', 'À VOTRE IMAGE'];

export function EventHeroAccent() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) return;

    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % phrases.length);
    }, 3200);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="relative block min-h-[1.05em] overflow-hidden text-[var(--color-secondary)]" aria-live="polite">
      <span key={phrases[index]} className="block animate-[eventHeroWord_.45s_ease-out]">
        {phrases[index]}
      </span>
      <style jsx>{`
        @keyframes eventHeroWord {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          span { animation: none !important; }
        }
      `}</style>
    </span>
  );
}
