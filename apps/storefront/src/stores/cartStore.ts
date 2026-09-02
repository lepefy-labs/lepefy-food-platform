import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem } from '@lepefy/types';
import type { CartMutationInput, CartSyncStatus, PendingMutation } from '@/lib/cart/cartTypes';
import { enqueueMutation } from '@/lib/cart/cartQueue';
import { trackNalaAddToCart } from '@/lib/ai/nalaAttributionClient';

interface CartState {
  items: CartItem[];

  // ─── Stato di sincronizzazione (nuovo) ──────────────────────────────────
  syncStatus:    CartSyncStatus;
  /** Ultima versione server conosciuta — null finché non si è mai sincronizzato. */
  serverVersion: number | null;
  lastSyncedAt:  string | null;
  /**
   * Coda delle mutation non ancora confermate dal server. Persistita insieme
   * al carrello (stesso storage, stessa scrittura atomica): sopravvive a
   * refresh, navigazione e chiusura del tab senza bisogno di beforeunload.
   */
  pendingMutations: PendingMutation[];
  /**
   * Cliente proprietario della coda. Le mutation vengono accodate SOLO se
   * valorizzato — un guest non genera mai traffico di rete — e la coda viene
   * scartata se il proprietario cambia: mai il carrello del cliente A inviato
   * sulla sessione del cliente B.
   */
  ownerCustomerId: string | null;
  /** Prodotti rifiutati dal server (inattivi/eliminati) alla scorsa sync. */
  unavailableProductIds: string[];

  // ─── API pubblica esistente — firme invariate ───────────────────────────
  addItem: (product: CartItem['product'], quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: () => number;
  totalPrice: () => number;
  totalWeightG: () => number;
  /** Payload pronto per POST /api/shipping/quote */
  shippingPayload: () => Array<{ product_id: string; weight_grams: number | null; quantity: number }>;

  // ─── API di sincronizzazione (usata dal sync engine) ────────────────────
  pendingMutationCount: () => number;
}

// Il flush è registrato dal sync engine all'avvio. Inversione di dipendenza
// volontaria: lo store non importa mai l'engine (che a sua volta importa lo
// store), così non esiste ciclo di import e lo store resta testabile da solo.
let flushScheduler: () => void = () => {};

export function registerCartFlushScheduler(scheduler: () => void): void {
  flushScheduler = scheduler;
}

/**
 * Accoda una mutation e programma il flush. Chiamata dalle azioni dello store
 * DOPO l'aggiornamento dello stato locale: la UI non attende mai la rete
 * (local-first), la mutation è già persistita quando la richiesta parte.
 */
function queueMutation(
  state: Pick<CartState, 'ownerCustomerId' | 'pendingMutations'>,
  input: CartMutationInput,
): Partial<CartState> {
  if (!state.ownerCustomerId) return {};
  return { pendingMutations: enqueueMutation(state.pendingMutations, input) };
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      syncStatus:            'idle',
      serverVersion:         null,
      lastSyncedAt:          null,
      pendingMutations:      [],
      ownerCustomerId:       null,
      unavailableProductIds: [],

      addItem(product, quantity = 1) {
        set((state) => {
          const existing = state.items.find((i) => i.product.id === product.id);
          const items = existing
            ? state.items.map((i) =>
                i.product.id === product.id
                  ? { ...i, quantity: Math.min(i.quantity + quantity, product.stock) }
                  : i,
              )
            : [...state.items, { product, quantity }];

          // Operazione RELATIVA: due "+1" da due device diversi si sommano lato
          // server invece di sovrascriversi (cf. lib/cart/cartTypes.ts).
          return {
            items,
            ...queueMutation(state, { type: 'add', productId: product.id, quantity }),
          };
        });
        flushScheduler();
        void trackNalaAddToCart(product.id, quantity);
      },

      removeItem(productId) {
        set((state) => ({
          items: state.items.filter((i) => i.product.id !== productId),
          ...queueMutation(state, { type: 'remove', productId }),
        }));
        flushScheduler();
      },

      updateQuantity(productId, quantity) {
        if (quantity <= 0) { get().removeItem(productId); return; }
        set((state) => ({
          items: state.items.map((i) =>
            i.product.id === productId ? { ...i, quantity } : i,
          ),
          // Operazione ASSOLUTA: intento esplicito dell'utente, il server non
          // deve mai sommarla a quanto già presente.
          ...queueMutation(state, { type: 'set_quantity', productId, quantity }),
        }));
        flushScheduler();
      },

      clearCart() {
        set((state) => ({
          items: [],
          ...queueMutation(state, { type: 'clear' }),
        }));
        flushScheduler();
      },

      totalItems() {
        return get().items.reduce((sum, i) => sum + i.quantity, 0);
      },

      totalPrice() {
        return get().items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
      },

      totalWeightG() {
        return get().items.reduce(
          (sum, i) => sum + (i.product.weight_grams ?? 400) * i.quantity,
          0,
        );
      },

      shippingPayload() {
        return get().items.map((i) => ({
          product_id:   i.product.id,
          weight_grams: i.product.weight_grams,
          quantity:     i.quantity,
        }));
      },

      pendingMutationCount() {
        return get().pendingMutations.length;
      },
    }),
    {
      name: 'lepefy-cart',
      // Versione dello schema persistito: i carrelli guest già in localStorage
      // non hanno i nuovi campi. `migrate` li completa con valori neutri invece
      // di far cadere il carrello dell'utente al primo deploy.
      version: 1,
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<CartState>;
        return {
          ...state,
          items:                 state.items ?? [],
          syncStatus:            'idle',
          serverVersion:         null,
          lastSyncedAt:          null,
          pendingMutations:      [],
          ownerCustomerId:       null,
          unavailableProductIds: [],
        } as CartState;
      },
      // syncStatus non viene persistito di proposito: al reload è sempre da
      // ricalcolare ('syncing' salvato su disco sarebbe una bugia permanente).
      partialize: (state) => ({
        items:                 state.items,
        serverVersion:         state.serverVersion,
        lastSyncedAt:          state.lastSyncedAt,
        pendingMutations:      state.pendingMutations,
        ownerCustomerId:       state.ownerCustomerId,
        unavailableProductIds: state.unavailableProductIds,
      }),
    },
  ),
);
