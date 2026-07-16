'use client';
import { useState } from 'react';
import { useCartStore } from '@/stores/cartStore';

interface Props {
  product: {
    id: string;
    name: string;
    slug: string;
    price: number;
    image_url: string | null;
    weight_grams?: number | null;
    stock?: number | null;
  };
}

export function AddToCartButton({ product }: Props) {
  const [added, setAdded] = useState(false);
  const addItem = useCartStore((s) => s.addItem);

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (product.stock === 0) return;
    addItem({
      id: product.id,
      name: product.name,
      slug: product.slug,
      price: product.price,
      image_url: product.image_url,
      weight_grams: product.weight_grams ?? null,
      stock: product.stock ?? 999,
      storage_type: null,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  return (
    <button
      onClick={handleAdd}
      aria-label="Ajouter au panier"
      className="absolute bottom-2 right-2 w-11 h-11 rounded-full flex items-center
                 justify-center text-white text-base font-bold
                 transition-all active:scale-90 shadow-sm"
      style={{ backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}
    >
      {added ? '✓' : '+'}
    </button>
  );
}
