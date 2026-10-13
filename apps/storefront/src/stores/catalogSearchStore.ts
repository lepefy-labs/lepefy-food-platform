import { create } from 'zustand';

/**
 * Recherche du Catalogue en cours de navigation. Le champ vit dans le layout
 * (GlobalProductSearch), la grille dans CatalogClient : ce drapeau éphémère
 * permet à la grille d'afficher son squelette pendant la transition.
 */
export const useCatalogSearchStore = create<{ pending: boolean; setPending: (pending: boolean) => void }>((set) => ({
  pending: false,
  setPending: (pending) => set({ pending }),
}));
