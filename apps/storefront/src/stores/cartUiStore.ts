import { create } from 'zustand';

// État UI éphémère (jamais persisté — un drawer rouvert après un refresh
// serait une surprise pour l'utilisateur). Séparé de cartStore.ts à dessein :
// cartStore reste la seule source de vérité pour les DONNÉES du panier, ce
// store ne porte que la visibilité du drawer et le retour visuel des ajouts.
// Zustand plutôt qu'un Context React : c'est déjà le pattern du repo pour un
// état global simple accessible sans prop-drilling (cartStore, localeStore).
interface CartUiState {
  isDrawerOpen: boolean;
  /** Incrémenté à chaque ajout réel du client (jamais par la sync ou le merge). */
  addRevision: number;
  lastAddAt: number | null;
  /** Dernière consultation du panier (drawer ou page) : calme les rappels. */
  lastViewAt: number | null;
  /**
   * Recherche du panier en cours de saisie (clavier ouvert sur mobile) : la
   * BottomNav et la barre « Livraison et paiement » s'effacent le temps de la saisie.
   */
  cartSearchActive: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  notifyAdd: () => void;
  markViewed: () => void;
  setCartSearchActive: (active: boolean) => void;
}

export const useCartUiStore = create<CartUiState>((set) => ({
  isDrawerOpen: false,
  addRevision: 0,
  lastAddAt: null,
  lastViewAt: null,
  cartSearchActive: false,
  openDrawer:  () => set({ isDrawerOpen: true, lastViewAt: Date.now() }),
  closeDrawer: () => set({ isDrawerOpen: false }),
  notifyAdd:   () => set((state) => ({ addRevision: state.addRevision + 1, lastAddAt: Date.now() })),
  markViewed:  () => set({ lastViewAt: Date.now() }),
  setCartSearchActive: (active) => set({ cartSearchActive: active }),
}));
