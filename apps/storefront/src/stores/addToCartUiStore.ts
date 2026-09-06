'use client';

import { create } from 'zustand';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';

/** Ephemeral feedback only. Quantities always come from cartStore. */
export const useAddToCartUiStore = create<{
  product: ProductCardProduct | null;
  revision: number;
  show: (product: ProductCardProduct) => void;
  close: () => void;
}>((set) => ({
  product: null,
  revision: 0,
  show: (product) => set((state) => ({ product, revision: state.revision + 1 })),
  close: () => set({ product: null }),
}));
