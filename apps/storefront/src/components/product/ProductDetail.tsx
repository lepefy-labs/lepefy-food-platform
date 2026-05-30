'use client';
import { useState } from 'react';
import Image from 'next/image';
import { useTenant } from '@/providers/TenantProvider';
import { useCartStore } from '@/stores/cartStore';
import { QuantitySelector } from './QuantitySelector';
import { formatPrice } from '@/lib/utils/format';
import type { ProductWithCategory } from '@lepefy/types';

export function ProductDetail({ product }: { product: ProductWithCategory }) {
  const { currency } = useTenant();
  const addItem = useCartStore((s) => s.addItem);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const outOfStock = product.stock === 0;

  function handleAddToCart() {
    addItem({ id: product.id, name: product.name, slug: product.slug, price: product.price, image_url: product.image_url, weight_grams: product.weight_grams, stock: product.stock }, quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
      <div className="aspect-square bg-gray-100 rounded-2xl overflow-hidden relative">
        {product.image_url ? (
          <Image src={product.image_url} alt={product.name} fill className="object-cover" sizes="(max-width: 768px) 100vw, 50vw" priority />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-200">
            <svg className="w-24 h-24" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-4">
        {product.category && <p className="text-sm font-medium uppercase tracking-wide" style={{ color: 'var(--color-primary)' }}>{product.category.name}</p>}
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">{product.name}</h1>
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold" style={{ color: 'var(--color-primary)' }}>{formatPrice(product.price, currency)}</span>
          {product.compare_at_price && product.compare_at_price > product.price && (
            <span className="text-lg text-gray-400 line-through">{formatPrice(product.compare_at_price, currency)}</span>
          )}
        </div>
        {product.description && <p className="text-gray-600 leading-relaxed">{product.description}</p>}
        {product.weight_grams && (
          <p className="text-sm text-gray-400">Poids : {product.weight_grams >= 1000 ? `${(product.weight_grams / 1000).toFixed(2)} kg` : `${product.weight_grams} g`}</p>
        )}
        {outOfStock ? (
          <div className="py-3 px-4 bg-gray-100 rounded-lg text-gray-500 text-sm font-medium text-center">Produit épuisé</div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700">Quantité</span>
              <QuantitySelector value={quantity} min={1} max={product.stock} onChange={setQuantity} />
            </div>
            <button onClick={handleAddToCart} className="w-full py-3 px-6 rounded-xl font-semibold text-white transition-all active:scale-95" style={{ backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}>
              {added ? '✓ Ajouté au panier' : 'Ajouter au panier'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
