'use client';

import type { CartItem } from '@lepefy/types';
import { useHasMounted } from '@/hooks/useHasMounted';
import { useCartStore } from '@/stores/cartStore';
import { selectCartItemCount, selectCartItems } from './cartSelectors';

type CartStoreState = ReturnType<typeof useCartStore.getState>;

const NO_ITEMS: CartItem[] = [];

/**
 * Lecture du panier persisté (localStorage, synchrone côté client) sûre pour
 * l'hydratation : rend `serverValue` — ce que le serveur a vu, un panier vide —
 * au rendu serveur et pendant l'hydratation, la valeur du store ensuite. Tout
 * composant rendu côté serveur dont l'affichage dépend du panier passe par ici,
 * sans quoi un panier non vide fait basculer toute la page en rendu client.
 * Les actions (`getState()`, handlers) lisent toujours le store directement.
 */
export function useHydratedCartSelector<T>(selector: (state: CartStoreState) => T, serverValue: T): T {
  const hydrated = useHasMounted();
  const value = useCartStore(selector);
  return hydrated ? value : serverValue;
}

export function useHydratedCartItems(): CartItem[] {
  return useHydratedCartSelector(selectCartItems, NO_ITEMS);
}

export function useHydratedCartCount(): number {
  return useHydratedCartSelector(selectCartItemCount, 0);
}
