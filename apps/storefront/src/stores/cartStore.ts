import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CartItem } from '@lepefy/types';

interface CartState {
  items: CartItem[];
  addItem: (product: CartItem['product'], quantity?: number) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: () => number;
  totalPrice: () => number;
  totalWeightG: () => number;
  /** Payload pronto per POST /api/shipping/quote */
  shippingPayload: () => Array<{ weight_grams: number | null; quantity: number }>;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem(product, quantity = 1) {
        set((state) => {
          const existing = state.items.find((i) => i.product.id === product.id);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.product.id === product.id
                  ? { ...i, quantity: Math.min(i.quantity + quantity, product.stock) }
                  : i,
              ),
            };
          }
          return { items: [...state.items, { product, quantity }] };
        });
      },

      removeItem(productId) {
        set((state) => ({ items: state.items.filter((i) => i.product.id !== productId) }));
      },

      updateQuantity(productId, quantity) {
        if (quantity <= 0) { get().removeItem(productId); return; }
        set((state) => ({
          items: state.items.map((i) =>
            i.product.id === productId ? { ...i, quantity } : i,
          ),
        }));
      },

      clearCart() { set({ items: [] }); },

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
          weight_grams: i.product.weight_grams,
          quantity:     i.quantity,
        }));
      },
    }),
    { name: 'lepefy-cart' },
  ),
);
