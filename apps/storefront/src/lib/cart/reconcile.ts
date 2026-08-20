import type { CartItem } from '@lepefy/types';
import type { PendingMutation } from './cartTypes';

// Riconciliazione PURA: riapplica le mutation ancora pendenti sopra lo stato
// canonical restituito dal server.
//
// È il cuore della gestione dei 409 e della sincronizzazione multi-device:
//   - lo stato server è la base (contiene le modifiche degli altri device)
//   - le mutation locali non ancora confermate vengono riapplicate sopra
// Nessuna delle due parti "vince" automaticamente: il server porta ciò che
// l'utente ha fatto altrove, la coda locale porta ciò che ha fatto qui e che
// non è ancora arrivato. Nulla viene scartato.

type ProductRef = CartItem['product'];

function buildProductIndex(...sources: CartItem[][]): Map<string, ProductRef> {
  const index = new Map<string, ProductRef>();
  // Le sorgenti sono lette in ordine e la PRIMA vince: si passa sempre lo
  // stato server per primo, le cui info prodotto (prezzo/stock) sono appena
  // state rilette dal DB e quindi più fresche di quelle locali.
  for (const items of sources) {
    for (const item of items) {
      if (!index.has(item.product.id)) index.set(item.product.id, item.product);
    }
  }
  return index;
}

/**
 * @param serverItems  stato canonical appena letto dal server
 * @param localItems   stato locale corrente (fonte delle info prodotto per gli
 *                     articoli che il server non conosce ancora)
 * @param pending      mutation non ancora confermate dal server
 */
export function reconcileCart(
  serverItems: CartItem[],
  localItems: CartItem[],
  pending: PendingMutation[],
): CartItem[] {
  const products = buildProductIndex(serverItems, localItems);
  let items: CartItem[] = serverItems.map((i) => ({ ...i }));

  for (const mutation of pending) {
    if (mutation.type === 'clear') {
      items = [];
      continue;
    }

    const product = products.get(mutation.productId);
    // Prodotto sconosciuto sia al server sia allo stato locale: impossibile
    // materializzare una riga di carrello senza prezzo/stock. La mutation resta
    // in coda, sarà il server ad applicarla e la GET successiva a riportarla.
    if (!product) continue;

    const index    = items.findIndex((i) => i.product.id === mutation.productId);
    const current  = items[index]?.quantity ?? 0;

    let quantity: number;
    if (mutation.type === 'add')               quantity = current + mutation.quantity;
    else if (mutation.type === 'set_quantity') quantity = mutation.quantity;
    else                                       quantity = 0;

    quantity = Math.max(0, Math.min(quantity, product.stock));

    if (quantity === 0) {
      if (index >= 0) items = items.filter((_, i) => i !== index);
      continue;
    }

    if (index >= 0) {
      items = items.map((item, i) => (i === index ? { ...item, quantity } : item));
    } else {
      items = [...items, { product, quantity }];
    }
  }

  return items;
}
