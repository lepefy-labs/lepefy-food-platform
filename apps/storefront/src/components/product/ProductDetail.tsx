'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getShoppingReturn, markShoppingReturn } from '@/lib/catalog/shoppingReturn';
import { useCartLineQuantity } from '@/lib/cart/useCartLineQuantity';
import { CartStepper } from '@/components/cart/CartStepper';
import { PromoBadge } from '@/components/catalog/PromoBadge';
import { NoveltyBadge } from '@/components/catalog/NoveltyBadge';
import { promotionEndLabel } from '@/lib/catalog/promotions';
import { useHydratedCartItems } from '@/lib/cart/useHydratedCart';
import { useLocaleStore, resolveLocale } from '@/lib/store/localeStore';
import { useTenant } from '@/providers/TenantProvider';
import { useCartStore } from '@/stores/cartStore';
import { useAddToCartUiStore } from '@/stores/addToCartUiStore';
import type { ProductCardProduct } from '@/components/catalog/ProductCard';
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
import { buildSaleFormatOptions, describeBundle, planFormatBundle, type SaleFormatRow } from '@/lib/catalog/saleFormats';
import { useFormatUnits } from '@/lib/cart/useFormatUnits';
import { bundleCaption } from '@/lib/storefrontCopy/saleFormatCopy';
import { SaleFormatPicker } from './SaleFormatPicker';

export function ProductDetail({ product }: { product: ProductWithCategory & { formats?: SaleFormatRow[] | null } }) {
  const router = useRouter();
  const tenant = useTenant();
  const catalogHref = product.category?.catalog_scope === 'gadgets' ? '/gadgets' : '/';
  const { currency } = tenant;
  const storeLocale = useLocaleStore((s) => s.locale);
  const tenantLocales = tenant.locales ?? [];
  const activeLocale = resolveLocale(storeLocale, tenantLocales);

  const addItem = useCartStore((s) => s.addItem);
  const cartItems = useHydratedCartItems();
  const { groups, loading: groupsLoading, error: groupsError, reload: reloadGroups } = useQuantityGroups();
  // Formats de vente (187) : choix explicite, jamais de présélection. Sans
  // format enfant actif, `formatOptions` est vide et la fiche reste inchangée.
  const formatOptions = buildSaleFormatOptions(product);
  const multiFormat = formatOptions.length > 0;
  const [selectedFormatId, setSelectedFormatId] = useState<string | null>(null);
  const selectedFormat = formatOptions.find((option) => option.id === selectedFormatId) ?? null;
  const anyFormatPurchasable = formatOptions.some((option) => option.purchasable);
  // Regroupement automatique (187 v2) : un seul compteur en unités de base pour
  // toute la fiche. Avant l'ajout aussi, « Quantité » compte des paquets : le
  // format choisi ne fait que fixer le point de départ (1 ou 3) et le format
  // surligné suit la combinaison la moins chère (3 paquets → le lot).
  const formatParent = { ...product, fulfillment_policy: normalizeFulfillmentPolicy(product.fulfillment_policy) };
  const formatUnits = useFormatUnits(formatParent, formatOptions);
  const minOrderQuantity = multiFormat ? 1 : product.min_order_quantity ?? 1;
  const orderQuantityStep = multiFormat ? 1 : product.order_quantity_step ?? 1;
  const [quantity, setQuantity] = useState(minOrderQuantity);
  // « ✓ Ajouté » : retour bref sur le bouton uniquement. Les actions de
  // navigation vivent dans la confirmation partagée et dans la ligne « dans
  // votre panier », lue du panier : elles ne disparaissent jamais sur un timer.
  const [justAdded, setJustAdded] = useState(false);
  const justAddedTimer = useRef<ReturnType<typeof setTimeout>>();
  const showConfirmation = useAddToCartUiStore((s) => s.show);
  const [returnToResults, setReturnToResults] = useState(false);
  const line = useCartLineQuantity(product.id);
  const inCartQuantity = multiFormat ? 0 : line.quantity;
  // Plusieurs formats : unités encore ajoutables (stock partagé moins le panier).
  const maxPurchasable = multiFormat
    ? (anyFormatPurchasable ? Math.max(0, formatUnits.maxUnits - formatUnits.units) : 0)
    : getMaximumValidQuantity(product.stock, minOrderQuantity, orderQuantityStep);
  const outOfStock = maxPurchasable === 0;
  // Plusieurs formats : épuisé seulement si aucun format n'est achetable ; avant
  // le choix, aucun minimum ne s'applique encore (chaque format a le sien).
  const availability = !multiFormat
    ? deriveAvailability({ stock: product.stock, minimum: minOrderQuantity, step: orderQuantityStep, maxPurchasable })
    : !anyFormatPurchasable
      ? deriveAvailability({ stock: 0, minimum: 1, step: 1, maxPurchasable: 0 })
      : deriveAvailability({ stock: Number.MAX_SAFE_INTEGER, minimum: 1, step: 1, maxPurchasable: Number.MAX_SAFE_INTEGER });
  const sellingFormat = resolveSellingFormat(product);
  // Ce qui est en train d'être choisi (avant l'ajout) : combinaison des paquets
  // demandés, et ce que l'ajout coûte vraiment une fois recomposé avec le panier.
  const pickPlan = multiFormat && selectedFormat ? planFormatBundle(quantity, formatOptions) : null;
  const afterAddPlan = multiFormat && selectedFormat ? planFormatBundle(formatUnits.units + quantity, formatOptions) : null;
  const highlightedFormatId = multiFormat && pickPlan
    ? ([...pickPlan.lines].sort((a, b) => b.option.units - a.option.units)[0]?.option.id ?? selectedFormatId)
    : selectedFormatId;
  const unitPrice = product.price;
  // Le bouton annonce le prix des paquets choisis eux-mêmes (2 paquets = 2 × le
  // prix du paquet) ; l'effet sur le panier (regroupement en lot) est dit à part.
  const totalPrice = multiFormat ? pickPlan?.total ?? 0 : unitPrice * quantity;
  const needsFormatChoice = multiFormat && !selectedFormat;
  // Bouton d'ajout toujours actif : sans format choisi, il explique quoi faire
  // et ramène au choix (jamais un bouton grisé sans explication).
  const [formatPrompt, setFormatPrompt] = useState(false);
  const formatPickerRef = useRef<HTMLElement>(null);
  const countLabel = (count: number) => formatCount(sellingFormat, count);
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
  // Encadré « Achetez N minimum » : produits à format unique seulement.
  const hasIndividualRule = !multiFormat && (minOrderQuantity > 1 || orderQuantityStep > 1);
  const quantityLabel = countLabel(quantity);
  const explicitQuantityLabel = `Ajouter ${quantityLabel}`;
  const ruleStepLine = stepLine(minOrderQuantity, orderQuantityStep);
  const fulfillmentPolicy = normalizeFulfillmentPolicy(product.fulfillment_policy);
  const fulfillmentHint = productFulfillmentHint(fulfillmentPolicy, Boolean(tenant.click_collect_enabled));
  const FulfillmentIcon = fulfillmentPolicy === 'pickup_only' ? IconBuildingStore : fulfillmentPolicy === 'delivery_only' ? IconTruck : IconTruckDelivery;

  // Lu après l'hydratation (sessionStorage) : la page reste identique au rendu ISR.
  useEffect(() => {
    setReturnToResults(new URL(getShoppingReturn(catalogHref), window.location.origin).searchParams.has('q'));
  }, [catalogHref]);
  useEffect(() => () => clearTimeout(justAddedTimer.current), []);
  // Déjà dans le panier : la fiche montre le même +/− que le panier (la
  // quantité réelle du panier), au lieu d'un sélecteur qui ajouterait par-dessus.
  // La barre d'achat mobile garde la même hauteur dans les deux états.
  // Plusieurs formats : compteur en unités tant qu'aucun format n'est choisi pour un nouvel ajout.
  const showsCartLine = multiFormat
    ? formatUnits.units > 0 && !selectedFormat && anyFormatPurchasable
    : inCartQuantity > 0 && !outOfStock;
  const cartUnitsLabel = (count: number) => formatCount(sellingFormat, count);

  function continueShopping() {
    markShoppingReturn();
    router.push(getShoppingReturn(catalogHref), { scroll: false });
  }

  function chooseFormat(id: string) {
    const option = formatOptions.find((entry) => entry.id === id);
    if (!option) return;
    setSelectedFormatId(id);
    setFormatPrompt(false);
    // Point de départ en unités de base : 1 paquet → 1, lot de 3 → 3.
    setQuantity(Math.max(1, Math.min(option.units * option.minimum, Math.max(1, maxPurchasable))));
  }

  // « Quantité » compte des paquets : la toucher vaut choix (le format surligné suit la combinaison).
  function changeQuantity(next: number) {
    setQuantity(next);
    if (multiFormat && !selectedFormat) {
      const base = formatOptions.find((option) => option.isBase && option.purchasable);
      if (base) setSelectedFormatId(base.id);
    }
    setFormatPrompt(false);
  }

  function handleAddToCart() {
    if (needsFormatChoice) {
      setFormatPrompt(true);
      const picker = formatPickerRef.current;
      if (picker) {
        picker.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
        picker.querySelector<HTMLInputElement>('input[type="radio"]:not([disabled])')?.focus({ preventScroll: true });
      }
      return;
    }
    if (outOfStock || quantity > maxPurchasable) return;
    if (selectedFormat) {
      // Le format choisi dit combien d'unités ajouter ; le panier choisit la combinaison.
      if (!formatUnits.addUnits(quantity)) return;
      clearTimeout(justAddedTimer.current);
      setJustAdded(true);
      justAddedTimer.current = setTimeout(() => setJustAdded(false), 1200);
      setSelectedFormatId(null);
      return;
    }
    const cartProductId = product.id;
    const previous = useCartStore.getState().items.find((item) => item.product.id === cartProductId)?.quantity ?? 0;
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
    const updated = useCartStore.getState().items.find((item) => item.product.id === cartProductId)?.quantity ?? 0;
    if (updated <= previous) return;
    clearTimeout(justAddedTimer.current);
    setJustAdded(true);
    justAddedTimer.current = setTimeout(() => setJustAdded(false), 1200);
    const cardProduct: ProductCardProduct = {
      ...product,
      category: product.category ? { name: product.category.name } : null,
      min_order_quantity: minOrderQuantity,
      order_quantity_step: orderQuantityStep,
      fulfillment_policy: normalizeFulfillmentPolicy(product.fulfillment_policy),
    };
    showConfirmation(cardProduct, { continueHref: getShoppingReturn(catalogHref) });
  }

  const cartStepper = multiFormat ? (
    <CartStepper
      variant="panel"
      quantity={formatUnits.units}
      productName={product.name}
      removesOnDecrement={formatUnits.removesOnDecrement}
      canIncrement={formatUnits.canIncrement}
      onIncrement={formatUnits.increment}
      onDecrement={formatUnits.decrement}
    />
  ) : (
    <CartStepper
      variant="panel"
      quantity={inCartQuantity}
      productName={product.name}
      removesOnDecrement={line.removesOnDecrement}
      canIncrement={line.canIncrement && inCartQuantity < maxPurchasable}
      onIncrement={line.increment}
      onDecrement={line.decrement}
    />
  );
  const cartQuantityText = multiFormat ? cartUnitsLabel(formatUnits.units) : countLabel(inCartQuantity);
  const cartTotal = multiFormat ? formatUnits.current?.total ?? 0 : unitPrice * inCartQuantity;
  const cartComposition = multiFormat ? bundleCaption(formatUnits.current, formatOptions, sellingFormat, currency) : null;
  const inCartLine = showsCartLine && (
    <p role="status" aria-live="polite" className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-1 text-sm text-green-900">
      <span>✓ <span className="font-bold">{cartQuantityText}</span> dans votre panier · {formatPrice(cartTotal, currency)}{cartComposition && cartComposition !== 'dans le panier' ? <span className="block text-xs font-semibold">{cartComposition}</span> : null}</span>
      <Link href="/cart" prefetch={false} className="inline-flex min-h-10 shrink-0 items-center font-bold underline underline-offset-2" style={{ color: 'var(--color-primary)' }}>Voir mon panier</Link>
    </p>
  );

  return (
    <div>
      {/* Fiche servie par l'ISR : ses liens vers le catalogue (dynamique) ne déclenchent pas de prefetch. */}
      <nav className="flex items-center gap-2 text-sm text-gray-400 mb-6" aria-label="Fil d'Ariane">
        <Link href={catalogHref} prefetch={false} className="hover:text-gray-600 transition-colors">{catalogHref === '/gadgets' ? 'Goodies' : 'Catalogue'}</Link>
        {product.category && (
          <>
            <span>/</span>
            <Link href={`${catalogHref}?category=${encodeURIComponent(product.category.slug)}`} prefetch={false} className="hover:text-gray-600 transition-colors">
              {product.category.name}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="text-gray-600">{product.name}</span>
      </nav>

      <button type="button" onClick={continueShopping}
        className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50">
        {returnToResults ? '← Retour aux résultats' : '← Retour au catalogue'}
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
          {/* Plusieurs formats en vente : pas de bloc prix, chaque format porte son prix
              dans le choix juste en dessous (sinon le prix du paquet apparaît deux fois). */}
          {multiFormat && anyFormatPurchasable ? (
            (product.new_until || product.compare_at_price != null || promotionEndLabel(product, 'long')) && (
              <div className="flex flex-wrap items-center gap-1.5">
                <NoveltyBadge product={product} />
                <PromoBadge product={product} />
                {promotionEndLabel(product, 'long') && (
                  <p className="text-sm font-semibold text-red-900">{promotionEndLabel(product, 'long')}</p>
                )}
              </div>
            )
          ) : (
            <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
              {(product.new_until || product.compare_at_price != null) && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <NoveltyBadge product={product} />
                  <PromoBadge product={product} />
                </div>
              )}
              <ProductPrice price={product.price} currency={currency} product={product} compareAtPrice={product.compare_at_price} size="detail" />
              {promotionEndLabel(product, 'long') && (
                <p className="mt-2 text-sm font-semibold text-red-900">{promotionEndLabel(product, 'long')}</p>
              )}
            </div>
          )}

          {multiFormat && anyFormatPurchasable && (
            <section ref={formatPickerRef} aria-label="Choix du format" className="grid gap-2">
              <SaleFormatPicker
                options={formatOptions}
                value={highlightedFormatId}
                onChange={chooseFormat}
                currency={currency}
                baseFormat={sellingFormat}
                unitContent={contentLabel(sellingFormat) ?? product.net_quantity_display}
              />
              {formatPrompt && needsFormatChoice && (
                <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950">
                  Choisissez d’abord un format ci-dessus, puis ajoutez au panier.
                </p>
              )}
              {pickPlan && (
                <p role="status" aria-live="polite" className="text-sm text-gray-900">
                  <span className="font-semibold">{cartUnitsLabel(quantity)}</span>
                  {pickPlan.lines.some((pickLine) => !pickLine.option.isBase) ? ` = ${describeBundle(pickPlan)}` : ''}
                  {pickPlan.savings > 0 ? <span className="font-semibold text-green-800"> · −{formatPrice(pickPlan.savings, currency)}</span> : null}
                </p>
              )}
              {formatUnits.units > 0 && selectedFormat && afterAddPlan && (
                <p className="text-sm text-gray-700">
                  Déjà dans votre panier : <span className="font-semibold">{cartUnitsLabel(formatUnits.units)}</span>.
                  {' '}Après l’ajout : <span className="font-semibold">{cartUnitsLabel(afterAddPlan.units)}</span>
                  {afterAddPlan.lines.some((planLine) => !planLine.option.isBase) ? ` = ${describeBundle(afterAddPlan)}` : ''}
                  {' '}· <span className="font-semibold">{formatPrice(afterAddPlan.total, currency)}</span> au total.
                </p>
              )}
            </section>
          )}

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
              <Link href={`/?quantityGroup=${encodeURIComponent(group.id)}`} prefetch={false} className="mt-1 inline-flex min-h-11 items-center font-semibold underline underline-offset-2" style={{ color: 'var(--color-primary)' }}>Voir les produits à mélanger</Link>
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
                {showsCartLine ? (
                  <>
                    {inCartLine}
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-medium text-gray-700">Quantité dans le panier</span>
                      {cartStepper}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-medium text-gray-700">Quantité</span>
                      <QuantitySelector value={quantity} min={minOrderQuantity} step={orderQuantityStep} max={maxPurchasable} onChange={changeQuantity} />
                    </div>
                    <button
                      onClick={handleAddToCart}
                      className="w-full py-3 px-6 rounded-xl font-semibold text-white transition-all active:scale-95 flex items-center justify-center gap-2"
                      style={{ backgroundColor: justAdded ? '#16a34a' : 'var(--color-primary)' }}
                    >
                      {justAdded ? '✓ Ajouté au panier' : needsFormatChoice ? 'Ajouter au panier' : `${explicitQuantityLabel} au panier · ${formatPrice(totalPrice, currency)}`}
                    </button>
                  </>
                )}
              </div>

              <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-[55] border-t border-gray-200 bg-white/95 shadow-[0_-8px_24px_rgba(15,23,42,0.10)] backdrop-blur md:hidden">
                <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2.5">
                  {showsCartLine ? (
                    <>
                      <div className="shrink-0">{cartStepper}</div>
                      <Link
                        href="/cart"
                        className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center rounded-xl px-3 py-2 font-semibold text-white"
                        style={{ backgroundColor: 'var(--color-primary)' }}
                      >
                        <span className="max-w-full truncate text-sm">Voir mon panier</span>
                        <span className="text-xs font-medium opacity-90">{cartQuantityText} · {formatPrice(cartTotal, currency)}</span>
                      </Link>
                    </>
                  ) : (
                    <>
                      <div className="shrink-0">
                        <span className="sr-only">Quantité</span>
                        <QuantitySelector value={quantity} min={minOrderQuantity} step={orderQuantityStep} max={maxPurchasable} onChange={changeQuantity} />
                      </div>
                      <button
                        onClick={handleAddToCart}
                        aria-live="polite"
                        className="flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center rounded-xl px-3 py-2 font-semibold text-white transition-all active:scale-[0.98]"
                        style={{ backgroundColor: justAdded ? '#16a34a' : 'var(--color-primary)' }}
                      >
                        <span className="max-w-full truncate text-sm">{justAdded ? '✓ Ajouté au panier' : needsFormatChoice ? 'Ajouter au panier' : explicitQuantityLabel}</span>
                        {!justAdded && !needsFormatChoice && <span className="text-xs font-medium opacity-90">Total : {formatPrice(totalPrice, currency)}</span>}
                      </button>
                    </>
                  )}
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
