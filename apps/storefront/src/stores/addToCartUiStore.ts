'use client';

import { create } from 'zustand';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';

export interface AddToCartConfirmationOptions {
  /**
   * Destination de « Continuer mes achats ». Absente (cards d'une liste) : la
   * confirmation se ferme et le client reste où il est. Depuis la fiche produit :
   * retour au catalogue ou aux résultats de recherche d'origine.
   */
  continueHref?: string;
}

/** Ephemeral feedback only. Quantities always come from cartStore. */
export const useAddToCartUiStore = create<{
  product: ProductCardProduct | null;
  continueHref: string | null;
  revision: number;
  show: (product: ProductCardProduct, options?: AddToCartConfirmationOptions) => void;
  close: () => void;
}>((set) => ({
  product: null,
  continueHref: null,
  revision: 0,
  show: (product, options) => set((state) => ({ product, continueHref: options?.continueHref ?? null, revision: state.revision + 1 })),
  close: () => set({ product: null, continueHref: null }),
}));
