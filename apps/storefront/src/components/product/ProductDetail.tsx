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
import { getMaximumValidQuantity } from '@/lib/purchaseQuantityRules';
import type { ProductWithCategory } from '@lepefy/types';

export function ProductDetail({ product }: { product: ProductWithCategory }) {
  const tenant = useTenant();
  const catalogHref = product.category?.catalog_scope === 'gadgets' ? '/gadgets' : '/';
  const { currency } = tenant;
  const storeLocale = useLocaleStore((s) => s.locale);
  const tenantLocales = tenant.locales ?? [];
  const activeLocale = resolveLocale(storeLocale, tenantLocales);

  const addItem = useCartStore((s) => s.addItem);
  const minOrderQuantity = product.min_order_quantity ?? 1;
  const orderQuantityStep = product.order_quantity_step ?? 1;
  const [quantity, setQuantity] = useState(minOrderQuantity);
  const [added, setAdded] = useState(false);
  const maxPurchasable = getMaximumValidQuantity(product.stock, minOrderQuantity, orderQuantityStep);
  const outOfStock = maxPurchasable === 0;
  const totalPrice = product.price * quantity;

  function handleAddToCart() {
    if (outOfStock || quantity > maxPurchasable) return;
    addItem({
      id:           product.id,
      name:         product.name,
      slug:         product.slug,
      price:        product.price,
      image_url:    product.image_url,
      weight_grams: product.weight_grams,
      stock:        product.stock,
      storage_type: product.storage_type ?? null,
      min_order_quantity:  product.min_order_quantity,
      order_quantity_step: product.order_quantity_step,
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
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold" style={{ color: 'var(--color-primary)' }}>
              {formatPrice(product.price, currency)}
            </span>
            <span className="text-sm font-medium text-gray-400">/ unité</span>
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
            <>
              <div className="hidden py-3 px-4 bg-gray-100 rounded-lg text-gray-500 text-sm font-medium text-center md:block">Indisponible dans le format minimum</div>
              <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-[55] border-t border-gray-200 bg-white/95 shadow-[0_-8px_24px_rgba(15,23,42,0.10)] backdrop-blur md:hidden">
                <div className="mx-auto max-w-7xl px-3 py-2.5">
                  <div className="flex min-h-12 items-center justify-center rounded-xl bg-gray-100 px-4 text-sm font-semibold text-gray-500">
                    Indisponible dans le format minimum
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="hidden flex-col gap-3 md:flex">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-gray-700">Quantité</span>
                  <QuantitySelector value={quantity} min={minOrderQuantity} step={orderQuantityStep} max={maxPurchasable} onChange={setQuantity} />
                  {minOrderQuantity > 1 && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">
                      Minimum {minOrderQuantity}{orderQuantityStep > 1 ? ` · par ${orderQuantityStep}` : ''}
                    </span>
                  )}
                </div>
                <button
                  onClick={handleAddToCart}
                  className="w-full py-3 px-6 rounded-xl font-semibold text-white transition-all active:scale-95 flex items-center justify-center gap-2"
                  style={{ backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}
                >
                  {added ? '✓ Ajouté au panier' : `Ajouter au panier — ${formatPrice(totalPrice, currency)}`}
                </button>
              </div>

              <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-[55] border-t border-gray-200 bg-white/95 shadow-[0_-8px_24px_rgba(15,23,42,0.10)] backdrop-blur md:hidden">
                <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2.5">
                  <div className="shrink-0">
                    <span className="sr-only">Quantité</span>
                    <QuantitySelector value={quantity} min={minOrderQuantity} step={orderQuantityStep} max={maxPurchasable} onChange={setQuantity} />
                  </div>
                  <button
                    onClick={handleAddToCart}
                    aria-live="polite"
                    className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center rounded-xl px-3 py-2 font-semibold text-white transition-all active:scale-[0.98]"
                    style={{ backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}
                  >
                    <span className="max-w-full truncate text-sm">{added ? '✓ Ajouté au panier' : 'Ajouter au panier'}</span>
                    {!added && <span className="text-xs font-medium opacity-90">{formatPrice(totalPrice, currency)}</span>}
                  </button>
                </div>
              </div>
            </>
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
