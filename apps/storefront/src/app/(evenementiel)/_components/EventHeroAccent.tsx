'use client';

import { useEffect, useState } from 'react';

const qualifiers = ['AVEC', 'POUR'];

export function EventHeroAccent() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) return;

    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % qualifiers.length);
    }, 3200);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="block text-[var(--color-secondary)]" aria-live="polite">
      <span className="relative block min-h-[1.05em] overflow-hidden">
        <span key={qualifiers[index]} className="block animate-[eventHeroWord_.45s_ease-out]">
          {qualifiers[index]}
        </span>
      </span>
      <span className="block">VOUS</span>
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
