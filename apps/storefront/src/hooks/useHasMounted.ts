'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * Faux au rendu serveur et pendant l'hydratation, vrai ensuite. Pour une
 * décision qui dépend du panier persisté (localStorage) : le premier rendu
 * reste identique au HTML serveur, sans écart d'hydratation. Un composant
 * monté après l'hydratation (navigation client) reçoit `true` dès son premier
 * rendu, sans passage intermédiaire par l'état serveur.
 */
export function useHasMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
