'use client';

import { useEffect, useState } from 'react';
import { ProductCard, type ProductCardProduct } from '@/components/catalog/ProductCard';
import { useCartStore } from '@/stores/cartStore';
import { recordAddSource } from '@/lib/cart/recordAddSource';
import { MAX_CART_SUGGESTION_SOURCES } from '@/lib/cart/cartSuggestionRules';

const LIMIT = 4;

/**
 * « Pour compléter » sous la fiche produit : complémentaires déclarés pour ce
 * produit, puis petits plus, promotions, meilleures ventes (`/api/cart/suggestions?anchor=`).
 * Lu côté client après l'affichage : la fiche reste une page ISR identique pour
 * tous. Jamais ce qui est déjà au panier, ni les « Vous aimerez aussi » affichés juste en dessous.
 */
export function ProductAddOns({ productId, excludeIds = [] }: { productId: string; excludeIds?: string[] }) {
  const [products, setProducts] = useState<ProductCardProduct[]>([]);
  const excludeKey = excludeIds.join(',');

  useEffect(() => {
    const controller = new AbortController();
    const inCart = useCartStore.getState().items.map((item) => item.product.id);
    const ids = [...new Set([...inCart, ...excludeKey.split(',').filter(Boolean)])].filter((id) => id !== productId).slice(0, MAX_CART_SUGGESTION_SOURCES);
    const params = new URLSearchParams({ anchor: productId, limit: String(LIMIT) });
    if (ids.length) params.set('ids', ids.join(','));
    fetch(`/api/cart/suggestions?${params.toString()}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { products: [] }))
      .then((data: { products?: ProductCardProduct[] }) => setProducts(data.products ?? []))
      .catch(() => { /* bloc facultatif */ });
    return () => controller.abort();
  }, [productId, excludeKey]);

  if (products.length === 0) return null;
  return (
    <section className="mt-12" aria-labelledby="product-add-ons-title">
      <h2 id="product-add-ons-title" className="font-display text-lg font-bold text-gray-900 mb-4">Pour compléter</h2>
      <div className="
        flex gap-3 overflow-x-auto pb-3
        [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]
        md:grid md:grid-cols-4 md:overflow-x-visible md:pb-0
      ">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} variant="shelf" onAdded={(added) => recordAddSource(added.id, 'product_page')} />
        ))}
      </div>
    </section>
  );
}
