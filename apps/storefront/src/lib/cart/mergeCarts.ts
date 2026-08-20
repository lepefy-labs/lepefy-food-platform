import type { CartItem } from '@lepefy/types';
import type { CartMutationInput } from './cartTypes';

export interface CartMergeResult {
  /** Stato del carrello dopo la fusione — da applicare allo store locale. */
  items: CartItem[];
  /**
   * Mutation da inviare al server per portarlo su questo stato. Vuoto se il
   * carrello server era già identico al risultato (caso A: nessuna richiesta).
   */
  mutations: CartMutationInput[];
}

/**
 * Fusione carrello guest (localStorage) ↔ carrello server, al login.
 * Funzione PURA e DETERMINISTICA: stessi input → stesso output, e rieseguirla
 * sul proprio risultato non lo cambia (idempotenza), proprietà indispensabile
 * perché il merge può ripartire dopo un refresh o un errore di rete a metà.
 *
 *   Caso A — locale vuoto, server pieno   → si adotta il carrello server.
 *   Caso B — locale pieno, server vuoto   → si carica il carrello locale.
 *   Caso C — entrambi pieni               → unione per prodotto:
 *              quantità = MAX(locale, server), MAI la somma.
 *
 * Perché il massimo e non la somma: le due quantità non sono due intenzioni
 * distinte da cumulare, sono la STESSA intenzione espressa due volte dallo
 * stesso utente su due device. Sommare "3 sul telefono" e "3 sul desktop" per
 * ottenere 6 è un risultato che l'utente non ha mai chiesto e che deve poi
 * correggere a mano (comportamento dell'implementazione precedente). Il massimo
 * invece: non perde mai un articolo, non perde mai la quantità più alta
 * realmente digitata, ed è idempotente — max(max(a,b), b) = max(a,b), mentre la
 * somma esplode ad ogni ripetizione del merge.
 *
 * Le informazioni prodotto del carrello server sono preferite: appena rilette
 * dal DB, quindi con prezzo e stock aggiornati, mentre quelle locali possono
 * essere ferme da settimane in localStorage.
 */
export function mergeGuestCartWithServerCart(
  localItems: CartItem[],
  serverItems: CartItem[],
): CartMergeResult {
  const serverById = new Map(serverItems.map((i) => [i.product.id, i]));
  const merged: CartItem[]           = [];
  const mutations: CartMutationInput[] = [];

  // Ordine deterministico: prima gli articoli server (nell'ordine del server),
  // poi quelli presenti solo in locale (nell'ordine locale).
  for (const serverItem of serverItems) {
    const localItem = localItems.find((i) => i.product.id === serverItem.product.id);
    const quantity  = clampToStock(
      localItem ? Math.max(localItem.quantity, serverItem.quantity) : serverItem.quantity,
      serverItem.product.stock,
    );

    if (quantity <= 0) continue;
    merged.push({ product: serverItem.product, quantity });

    // Solo se la fusione cambia davvero la quantità server serve una mutation.
    if (quantity !== serverItem.quantity) {
      mutations.push({ type: 'set_quantity', productId: serverItem.product.id, quantity });
    }
  }

  for (const localItem of localItems) {
    if (serverById.has(localItem.product.id)) continue;
    const quantity = clampToStock(localItem.quantity, localItem.product.stock);
    if (quantity <= 0) continue;

    merged.push({ product: localItem.product, quantity });
    // set_quantity e non add: al login si sta stabilendo uno stato noto, non si
    // sta incrementando qualcosa. Rende il merge ripetibile senza raddoppiare.
    mutations.push({ type: 'set_quantity', productId: localItem.product.id, quantity });
  }

  return { items: merged, mutations };
}

function clampToStock(quantity: number, stock: number): number {
  return Math.max(0, Math.min(quantity, stock));
}
