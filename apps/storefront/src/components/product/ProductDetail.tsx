'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useLocaleStore, resolveLocale } from '@/lib/store/localeStore';
import { useTenant } from '@/providers/TenantProvider';
import { useCartStore } from '@/stores/cartStore';
import { QuantitySelector } from './QuantitySelector';
import { ProductTitle } from './ProductTitle';
import { ProductDescription } from './ProductDescription';
import { ProductGallery } from './ProductGallery';
import { ProductSpecs } from './ProductSpecs';
import { ProductTabs } from './ProductTabs';
import { TrustBadges } from './TrustBadges';
import { formatPrice } from '@/lib/utils/format';
import type { ProductWithCategory } from '@lepefy/types';

export function ProductDetail({ product }: { product: ProductWithCategory }) {
  const tenant = useTenant();
  const catalogHref = product.category?.catalog_scope === 'gadgets' ? '/gadgets' : '/';
  const { currency } = tenant;
  const storeLocale = useLocaleStore((s) => s.locale);
  const tenantLocales = tenant.locales ?? [];
  const activeLocale = resolveLocale(storeLocale, tenantLocales);

  const addItem = useCartStore((s) => s.addItem);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const outOfStock = product.stock === 0;
  const totalPrice = product.price * quantity;

  function handleAddToCart() {
    addItem({
      id:           product.id,
      name:         product.name,
      slug:         product.slug,
      price:        product.price,
      image_url:    product.image_url,
      weight_grams: product.weight_grams,
      stock:        product.stock,
      storage_type: product.storage_type ?? null,
    }, quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }

  return (
    <div>
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6" aria-label="Fil d'Ariane">
        <Link href={catalogHref} className="hover:text-gray-600 transition-colors">{catalogHref === '/gadgets' ? 'Goodies' : 'Catalogue'}</Link>
        {product.category && (
          <>
            <span>/</span>
            <Link href={`${catalogHref}?category=${encodeURIComponent(product.category.slug)}`} className="hover:text-gray-600 transition-colors">
              {product.category.name}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="text-gray-600">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-14">
        <ProductGallery
          name={product.name}
          imageUrl={product.image_url}
          images={product.images ?? []}
          isHomemade={product.is_homemade}
        />

        <div className="flex flex-col gap-4">
          {product.category && (
            <p className="text-sm font-medium uppercase tracking-wide" style={{ color: 'var(--color-primary)' }}>
              {product.category.name}
            </p>
          )}
          <ProductTitle product={product} />
          <div className="flex items-baseline gap-3">
            <span className="font-display text-3xl font-semibold" style={{ color: 'var(--color-primary)' }}>
              {formatPrice(product.price, currency)}
            </span>
            {product.compare_at_price && product.compare_at_price > product.price && (
              <span className="text-lg text-gray-400 line-through">{formatPrice(product.compare_at_price, currency)}</span>
            )}
          </div>

          <ProductSpecs
            netQuantityDisplay={product.net_quantity_display}
            weightGrams={product.weight_grams}
            countryOfOrigin={product.country_of_origin}
            storageType={product.storage_type}
            locale={activeLocale}
          />

          <ProductDescription product={product} />

          {outOfStock ? (
            <div className="py-3 px-4 bg-gray-100 rounded-lg text-gray-500 text-sm font-medium text-center">Produit épuisé</div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-gray-700">Quantité</span>
                <QuantitySelector value={quantity} min={1} max={product.stock} onChange={setQuantity} />
              </div>
              <button
                onClick={handleAddToCart}
                className="w-full py-3 px-6 rounded-xl font-semibold text-white transition-all active:scale-95 flex items-center justify-center gap-2"
                style={{ backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}
              >
                {added ? '✓ Ajouté au panier' : `Ajouter au panier — ${formatPrice(totalPrice, currency)}`}
              </button>
            </div>
          )}

          <TrustBadges storageType={product.storage_type} />
        </div>
      </div>

      <ProductTabs
        ingredientsText={product.ingredients_text}
        allergensText={product.allergens_text}
        glutenFreeCertified={product.gluten_free_certified}
        conservationInstructions={product.conservation_instructions}
        conservationAfterOpening={product.conservation_after_opening}
        usageInstructions={product.usage_instructions}
      />
    </div>
  );
}
