'use client';

import { useState } from 'react';
import { useCartStore } from '@/stores/cartStore';
import type { ProductCardProduct } from './ProductCard';

/** Shared quick-add behavior for catalogue cards and the merchandise hero. */
export function useQuickAdd(product: ProductCardProduct) {
  const addItem = useCartStore(s => s.addItem);
  const [added, setAdded] = useState(false);
  const outOfStock = product.stock === 0;

  function addToCart() {
    if (outOfStock) return;
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
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }
  return { addToCart, added, outOfStock };
}
