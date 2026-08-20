import { create } from 'zustand';

// État UI éphémère (jamais persisté — un drawer rouvert après un refresh
// serait une surprise pour l'utilisateur). Séparé de cartStore.ts à dessein :
// cartStore reste la seule source de vérité pour les DONNÉES du panier, ce
// store ne porte que la visibilité du drawer. Zustand plutôt qu'un Context
// React : c'est déjà le pattern du repo pour un état global simple accessible
// sans prop-drilling (cartStore, localeStore).
interface CartUiState {
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

export const useCartUiStore = create<CartUiState>((set) => ({
  isDrawerOpen: false,
  openDrawer:  () => set({ isDrawerOpen: true }),
  closeDrawer: () => set({ isDrawerOpen: false }),
}));
