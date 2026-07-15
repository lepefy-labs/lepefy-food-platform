'use client';
import Link from 'next/link';
import Image from 'next/image';
import type { SemanticMatch } from '@lepefy/types';
import { useCartStore } from '@/stores/cartStore';
import { formatPrice } from '@/lib/utils/format';
import { useTenant } from '@/providers/TenantProvider';

/**
 * Carte produit pour les résultats de la recherche sémantique (match_products).
 * La RPC ne renvoie pas une relation `category` complète comme
 * ProductWithCategory (juste category_name) — carte dédiée plutôt que de
 * fabriquer un faux objet Category incomplet pour réutiliser ProductCard.
 */
export function SemanticProductCard({ product }: { product: SemanticMatch }) {
  const { currency } = useTenant();
  const addItem = useCartStore((s) => s.addItem);
  const outOfStock = product.stock === 0;

  function handleAddToCart(e: React.MouseEvent) {
    e.preventDefault();
    if (!outOfStock) addItem({
      id:           product.id,
      name:         product.name,
      slug:         product.slug,
      price:        product.price,
      image_url:    product.image_url,
      weight_grams: product.weight_grams,
      stock:        product.stock,
      storage_type: product.storage_type,
    });
  }

  return (
    <Link href={`/products/${product.slug}`} className="group block">
      <div className="rounded-xl overflow-hidden border border-gray-200 hover:border-gray-300 transition-all hover:shadow-md">
        <div className="aspect-square bg-gray-100 relative">
          {product.image_url ? (
            <Image src={product.image_url} alt={product.name} fill className="object-cover group-hover:scale-105 transition-transform duration-300" sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300">
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
          )}
          {outOfStock && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><span className="bg-white text-gray-700 text-xs font-medium px-2 py-1 rounded">Épuisé</span></div>}
        </div>
        <div className="p-3">
          <p className="text-sm font-medium text-gray-900 line-clamp-2 mb-1">{product.name}</p>
          {product.category_name && <p className="text-xs text-gray-400 mb-2">{product.category_name}</p>}
          <div className="flex items-center justify-between gap-2">
            <span className="text-base font-bold" style={{ color: 'var(--color-primary)' }}>{formatPrice(product.price, currency)}</span>
            <button onClick={handleAddToCart} disabled={outOfStock} className="text-xs px-3 py-1.5 rounded-lg font-medium text-white transition-opacity disabled:opacity-40" style={{ backgroundColor: 'var(--color-primary)' }}>Ajouter</button>
          </div>
        </div>
      </div>
    </Link>
  );
}
