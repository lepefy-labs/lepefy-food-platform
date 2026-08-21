'use client';

import { useEffect, useState } from 'react';

export function useCatalogMotionPreferences() {
  const [preferences, setPreferences] = useState({ isDesktop: false, reducedMotion: true });

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 768px)');
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPreferences({
      isDesktop: desktopQuery.matches,
      reducedMotion: reducedMotionQuery.matches,
    });

    update();
    desktopQuery.addEventListener('change', update);
    reducedMotionQuery.addEventListener('change', update);
    return () => {
      desktopQuery.removeEventListener('change', update);
      reducedMotionQuery.removeEventListener('change', update);
    };
  }, []);

  return preferences;
}
