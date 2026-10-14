'use client';

import { useEffect, useState } from 'react';

/**
 * Faux au rendu serveur et au premier rendu client, vrai ensuite. Pour une
 * décision qui dépend du panier persisté (localStorage) : le premier rendu
 * reste identique au HTML serveur, sans écart d'hydratation.
 */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted;
}
