import type { CartItem } from '@lepefy/types';

// Stato di sincronizzazione esposto dallo store (consumabile dalla UI in una
// task successiva — nessun componente attuale lo legge, nessuna regressione).
export type CartSyncStatus =
  | 'idle'      // nessun cliente autenticato, oppure niente da sincronizzare
  | 'syncing'   // richiesta in volo
  | 'synced'    // queue vuota, stato locale allineato al server
  | 'offline'   // navigator.onLine === false, mutation accumulate localmente
  | 'error'     // errore persistente, mutation conservate (mai scartate)
  | 'conflict'; // 409 in corso di riconciliazione

// Distinzione semantica fondamentale (cf. §19 della specifica):
//   add          → operazione RELATIVA  (l'utente ha premuto "+")
//   set_quantity → operazione ASSOLUTA  (l'utente ha imposto una quantità)
// Il server applica `add` come incremento, quindi due add concorrenti da due
// device diversi si preservano entrambi invece di sovrascriversi.
export type CartMutationInput =
  | { type: 'add';          productId: string; quantity: number }
  | { type: 'set_quantity'; productId: string; quantity: number }
  | { type: 'remove';       productId: string }
  | { type: 'clear' };

export type CartMutationType = CartMutationInput['type'];

// Mutation in coda: input + metadati necessari a idempotenza e retry.
// `id` è l'idempotency key realmente usata dal server (colonna
// carts.applied_mutation_ids), non un campo decorativo.
export type PendingMutation = CartMutationInput & {
  id:         string;
  createdAt:  string;
  retryCount: number;
};

// Payload effettivamente inviato al server: solo ciò che serve ad applicarlo.
// Nessun tenantId/customerId — l'identità è derivata dalla sessione lato
// server e non deve mai essere accettata dal client (cf. §22).
export interface CartMutationPayload {
  id:         string;
  type:       CartMutationType;
  productId?: string;
  quantity?:  number;
}

export interface CartSyncRequest {
  /** null = primo sync di questa sessione, il server non controlla la versione. */
  expectedVersion: number | null;
  mutations:       CartMutationPayload[];
}

export interface CartSyncResult {
  items:                 CartItem[];
  version:               number;
  appliedMutationIds:    string[];
  unavailableProductIds: string[];
}

export interface ServerCartState {
  items:   CartItem[];
  version: number;
}

export function toPayload(mutation: PendingMutation): CartMutationPayload {
  switch (mutation.type) {
    case 'add':
    case 'set_quantity':
      return { id: mutation.id, type: mutation.type, productId: mutation.productId, quantity: mutation.quantity };
    case 'remove':
      return { id: mutation.id, type: mutation.type, productId: mutation.productId };
    case 'clear':
      return { id: mutation.id, type: mutation.type };
  }
}

// crypto.randomUUID non è disponibile su Safari < 15.4 né in contesti non
// sicuri (http:// in dev su IP di rete locale) — fallback esplicito, un id
// mancante romperebbe l'idempotenza.
export function newMutationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
