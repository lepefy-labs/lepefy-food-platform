import type { CartItem } from '@lepefy/types';
import type { PendingMutation } from './cartTypes';

// Sélecteurs purs pour le CartDrawer/MiniCart — §24 de la spec redesign.
// Chacun ne lit qu'un seul morceau du store (jamais l'objet store entier) :
// un composant qui appelle `useCartStore(selectCartItemCount)` ne se
// re-render que quand ce nombre change réellement, pas à chaque mutation
// sans rapport (ex. syncStatus qui bascule pendant qu'on regarde le badge).
//
// Le calcul recoupe volontairement celui déjà fait par cartStore.totalItems()/
// totalPrice() (jamais modifié — la sync est hors périmètre de cette tâche) :
// dupliquer 2 lignes de reduce() ici évite d'exposer l'objet store complet à
// des composants qui n'ont besoin que d'un total.

interface CartItemsSource { items: CartItem[] }

export function selectCartItems(state: CartItemsSource): CartItem[] {
  return state.items;
}

/**
 * Articles du panier comptés comme le client les voit : un « Lot de 3 paquets »
 * compte 3 (formats de vente, migration 187), comme le compteur en paquets.
 */
export function selectCartItemCount(state: CartItemsSource): number {
  return state.items.reduce((sum, item) => sum + item.quantity * Math.max(1, item.product.units_per_sale ?? 1), 0);
}

export function selectCartSubtotal(state: CartItemsSource): number {
  return state.items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
}

export function selectCartIsEmpty(state: CartItemsSource): boolean {
  return state.items.length === 0;
}

interface PendingMutationsSource { pendingMutations: PendingMutation[] }

/**
 * Ensemble des productId ayant une mutation encore en attente d'envoi/
 * confirmation serveur — sert au badge "pending" discret du CartItem (§9).
 * `clear` n'a pas de productId : elle ne concerne aucun item individuel une
 * fois qu'il a disparu de `items`, donc rien à marquer.
 */
export function selectPendingProductIds(state: PendingMutationsSource): Set<string> {
  const ids = new Set<string>();
  for (const mutation of state.pendingMutations) {
    if (mutation.type !== 'clear') ids.add(mutation.productId);
  }
  return ids;
}
