'use client';

import { useEffect, useRef, useState } from 'react';
import { useCartStore } from '@/stores/cartStore';
import type { ProductCardProduct } from './ProductCard';

/** Shared quick-add behavior; merchandise retains its existing cart behavior. */
export function useQuickAdd(product: ProductCardProduct, enforceStockLimit = false) {
  const addItem = useCartStore(s => s.addItem);
  const quantity = useCartStore(s => s.items.find(item => item.product.id === product.id)?.quantity ?? 0);
  const storedStock = useCartStore(s => s.items.find(item => item.product.id === product.id)?.product.stock ?? 999);
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const outOfStock = product.stock === 0;
  const atLimit = enforceStockLimit && quantity >= Math.min(product.stock ?? 999, storedStock);

  useEffect(() => () => clearTimeout(timer.current), []);

  function addToCart(): boolean {
    if (outOfStock) return false;
    // Read at click time too: consecutive clicks must never enqueue excess mutations.
    const existing = useCartStore.getState().items.find(item => item.product.id === product.id);
    if (enforceStockLimit && (existing?.quantity ?? 0) >= Math.min(product.stock ?? 999, existing?.product.stock ?? 999)) return false;
    addItem({
      id: product.id,
      name: product.name,
      slug: product.slug,
      price: product.price,
      image_url: product.image_url,
      weight_grams: product.weight_grams,
      stock: product.stock ?? 999,
      storage_type: product.storage_type ?? null,
    });
    clearTimeout(timer.current);
    setAdded(true);
    timer.current = setTimeout(() => setAdded(false), 1500);
    return true;
  }
  return { addToCart, added, outOfStock, atLimit };
}
