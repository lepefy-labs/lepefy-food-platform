'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getShoppingReturn } from '@/lib/catalog/shoppingReturn';
import { useLocaleStore, resolveLocale } from '@/lib/store/localeStore';
import { useTenant } from '@/providers/TenantProvider';
import { useCartStore } from '@/stores/cartStore';
import { useQuantityGroups } from '@/lib/cart/useQuantityGroups';
import { QuantitySelector } from './QuantitySelector';
import { ProductTitle } from './ProductTitle';
import { ProductDescription } from './ProductDescription';
import { ProductGallery } from './ProductGallery';
import { ProductSpecs } from './ProductSpecs';
import { ProductTabs } from './ProductTabs';
import { TrustBadges } from './TrustBadges';
import { formatPrice } from '@/lib/utils/format';
import { computeQuantityRuleState, getMaximumValidQuantity } from '@/lib/purchaseQuantityRules';
import { contentLabel, formatCount, pickSellingFormatFields, quantityNoun, resolveSellingFormat } from '@/lib/storefrontCopy/sellingFormat';
import { groupHeadline, groupProgressCopy, minimumHeadline, nextQuantitiesList, stepLine } from '@/lib/storefrontCopy/quantityRuleCopy';
import { AVAILABILITY_COPY, belowMinimumDetail, deriveAvailability } from '@/lib/storefrontCopy/availability';
import { ProductPrice } from '@/components/catalog/ProductPrice';
import { IconBuildingStore, IconCircleOff, IconHourglassHigh, IconTruck, IconTruckDelivery } from '@tabler/icons-react';
import { normalizeFulfillmentPolicy } from '@/lib/fulfillment/fulfillmentPolicy';
import { productFulfillmentHint } from '@/lib/storefrontCopy/fulfillmentCopy';
import type { ProductWithCategory } from '@lepefy/types';

export function ProductDetail({ product }: { product: ProductWithCategory }) {
  const router = useRouter();
  const tenant = useTenant();
  const catalogHref = product.category?.catalog_scope === 'gadgets' ? '/gadgets' : '/';
  const { currency } = tenant;
  const storeLocale = useLocaleStore((s) => s.locale);
  const tenantLocales = tenant.locales ?? [];
  const activeLocale = resolveLocale(storeLocale, tenantLocales);

  const addItem = useCartStore((s) => s.addItem);
  const cartItems = useCartStore((s) => s.items);
  const { groups, loading: groupsLoading, error: groupsError, reload: reloadGroups } = useQuantityGroups();
  const minOrderQuantity = product.min_order_quantity ?? 1;
  const orderQuantityStep = product.order_quantity_step ?? 1;
  const [quantity, setQuantity] = useState(minOrderQuantity);
  const [added, setAdded] = useState(false);
  const maxPurchasable = getMaximumValidQuantity(product.stock, minOrderQuantity, orderQuantityStep);
  const outOfStock = maxPurchasable === 0;
  const availability = deriveAvailability({ stock: product.stock, minimum: minOrderQuantity, step: orderQuantityStep, maxPurchasable });
  const sellingFormat = resolveSellingFormat(product);
  const totalPrice = product.price * quantity;
  const group = groups.find((entry) => entry.productIds.includes(product.id));
  const groupQuantity = group
    ? cartItems.filter((item) => group.productIds.includes(item.product.id))
        .reduce((sum, item) => sum + item.quantity, 0)
    : 0;
  const groupState = group && groupQuantity > 0
    ? computeQuantityRuleState(groupQuantity, group.min_quantity, group.quantity_step)
    : null;
  const groupProgress = group && groupState
    ? groupProgressCopy(group.name, groupQuantity, groupState.nextValidQuantity, group.min_quantity)
    : null;
  const hasIndividualRule = minOrderQuantity > 1 || orderQuantityStep > 1;
  const quantityLabel = formatCount(sellingFormat, quantity);
  const explicitQuantityLabel = `Ajouter ${quantityLabel}`;
  const ruleStepLine = stepLine(minOrderQuantity, orderQuantityStep);
  const fulfillmentPolicy = normalizeFulfillmentPolicy(product.fulfillment_policy);
  const fulfillmentHint = productFulfillmentHint(fulfillmentPolicy, Boolean(tenant.click_collect_enabled));
  const FulfillmentIcon = fulfillmentPolicy === 'pickup_only' ? IconBuildingStore : fulfillmentPolicy === 'delivery_only' ? IconTruck : IconTruckDelivery;

  function continueShopping() {
    router.push(getShoppingReturn(catalogHref));
  }

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
      fulfillment_policy: normalizeFulfillmentPolicy(product.fulfillment_policy),
      ...pickSellingFormatFields(product),
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

      <button type="button" onClick={continueShopping}
        className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50">
        ← Retour au catalogue
      </button>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-14">
        <ProductGallery
          name={product.name}
          imageUrl={product.image_url}
          images={product.images ?? []}
          isHomemade={product.is_homemade}
          unavailable={availability === 'sold_out' || availability === 'below_minimum'}
        />

        <div className="flex flex-col gap-4">
          {product.category && (
            <p className="text-sm font-medium uppercase tracking-wide" style={{ color: 'var(--color-primary)' }}>
              {product.category.name}
            </p>
          )}
          <ProductTitle product={product} />
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
            <ProductPrice price={product.price} currency={currency} product={product} compareAtPrice={product.compare_at_price} size="detail" />
          </div>

          {availability === 'sold_out' || availability === 'below_minimum' ? (
            <section aria-label="Disponibilité" className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${availability === 'sold_out' ? 'border-gray-300 bg-gray-50 text-gray-900' : 'border-amber-300 bg-amber-50 text-amber-950'}`}>
              {availability === 'sold_out'
                ? <IconCircleOff size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
                : <IconHourglassHigh size={20} aria-hidden="true" className="mt-0.5 shrink-0" />}
              <div>
                <p className="font-bold">{availability === 'sold_out' ? AVAILABILITY_COPY.soldOutBadge : AVAILABILITY_COPY.belowMinimumBadge}</p>
                <p className="mt-0.5">{availability === 'sold_out' ? AVAILABILITY_COPY.soldOutDetail : belowMinimumDetail(minOrderQuantity)}</p>
              </div>
            </section>
          ) : hasIndividualRule && (
            <section aria-label="Quantité à acheter" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="text-base font-bold">{minimumHeadline(minOrderQuantity, quantityNoun(sellingFormat, minOrderQuantity))}</p>
              {ruleStepLine && <p className="mt-1">{ruleStepLine}</p>}
              <p className="mt-2 flex items-center justify-between gap-3 border-t border-amber-300 pt-2 font-semibold">
                <span>{formatCount(sellingFormat, minOrderQuantity)} × {formatPrice(product.price, currency)}</span>
                <span className="tabular-nums">{formatPrice(product.price * minOrderQuantity, currency)}</span>
              </p>
            </section>
          )}
          {group && (
            <section aria-label="Produits à mélanger" className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900">
              <p className="font-bold">{groupHeadline(group.name, group.min_quantity)}</p>
              {group.quantity_step > 1 && <p className="mt-1">Ensuite : {nextQuantitiesList(group.min_quantity, group.quantity_step)}</p>}
              {groupProgress && (
                <p className="mt-2 font-medium" aria-live="polite">
                  {groupProgress.done ? groupProgress.title : `${groupProgress.title}. ${groupProgress.detail}`}
                </p>
              )}
              <Link href={`/?quantityGroup=${encodeURIComponent(group.id)}`} className="mt-1 inline-flex min-h-11 items-center font-semibold underline underline-offset-2" style={{ color: 'var(--color-primary)' }}>Voir les produits à mélanger</Link>
            </section>
          )}
          {groupsError && (
            <div className="text-sm text-gray-700" role="status">
              Nous n&apos;arrivons pas à vérifier les produits à mélanger. <button type="button" onClick={reloadGroups} className="min-h-11 font-semibold underline">Réessayer</button>
            </div>
          )}
          {!group && groupsLoading && <p className="text-sm text-gray-600" role="status">Chargement…</p>}

          <ProductSpecs
            content={contentLabel(sellingFormat) ?? product.net_quantity_display}
            countryOfOrigin={product.country_of_origin}
            storageType={product.storage_type}
            locale={activeLocale}
          />

          <ProductDescription product={product} />

          {fulfillmentHint && (
            <section aria-label="Mode de réception" data-fulfillment-policy={fulfillmentPolicy}
              className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${fulfillmentHint.blocked ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-gray-200 bg-white text-gray-900'}`}>
              <FulfillmentIcon size={20} aria-hidden="true" className="mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">{fulfillmentHint.label}</p>
                <p className="mt-0.5 text-gray-700">{fulfillmentHint.detail}</p>
              </div>
            </section>
          )}

          {outOfStock ? (
            <>
              <div className="hidden py-3 px-4 bg-gray-200 rounded-lg text-gray-800 text-sm font-semibold text-center md:block">{AVAILABILITY_COPY.unavailableCta}</div>
              <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-[55] border-t border-gray-200 bg-white/95 shadow-[0_-8px_24px_rgba(15,23,42,0.10)] backdrop-blur md:hidden">
                <div className="mx-auto max-w-7xl px-3 py-2.5">
                  <div className="flex min-h-12 items-center justify-center rounded-xl bg-gray-200 px-4 text-sm font-semibold text-gray-800">
                    {AVAILABILITY_COPY.unavailableCta}
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

                </div>
                <button
                  onClick={handleAddToCart}
                  className="w-full py-3 px-6 rounded-xl font-semibold text-white transition-all active:scale-95 flex items-center justify-center gap-2"
                  style={{ backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}
                >
                  {added ? '✓ Ajouté au panier' : `${explicitQuantityLabel} au panier · ${formatPrice(totalPrice, currency)}`}
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
                    <span className="max-w-full truncate text-sm">{added ? '✓ Ajouté au panier' : explicitQuantityLabel}</span>
                    {!added && <span className="text-xs font-medium opacity-90">Total : {formatPrice(totalPrice, currency)}</span>}
                  </button>
                </div>
                {added && (
                  <div className="mx-auto flex max-w-7xl gap-2 px-3 pb-2">
                    <button type="button" onClick={continueShopping} className="min-h-11 flex-1 rounded-lg border border-gray-300 bg-white text-xs font-bold">Continuer mes achats</button>
                    <Link href="/cart" className="flex min-h-11 flex-1 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>Voir mon panier</Link>
                  </div>
                )}
              </div>
            </>
          )}

          {added && (
            <div role="status" className="hidden rounded-xl border border-green-200 bg-green-50 p-3 md:block">
              <p className="mb-2 text-sm font-semibold text-green-900">✓ {quantityLabel} dans le panier</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={continueShopping} className="min-h-11 flex-1 rounded-lg px-3 font-semibold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>Continuer mes achats</button>
                <Link href="/cart" className="flex min-h-11 flex-1 items-center justify-center rounded-lg border border-gray-300 px-3 text-sm font-semibold">Voir mon panier</Link>
              </div>
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
