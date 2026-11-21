'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { LepefyImage } from '@/components/images/LepefyImage';
import { IconInfoCircle, IconSnowflake, IconShoppingCart } from '@tabler/icons-react';
import type { CatalogScope, ProductFulfillmentPolicy } from '@lepefy/types';
import { useAddToCartUiStore } from '@/stores/addToCartUiStore';
import { useQuickAdd } from './useQuickAdd';
import { formatPrice } from '@/lib/utils/format';
import { useTenant } from '@/providers/TenantProvider';
import { ShopTag } from '@/components/ui/ShopTag';
import { rememberShoppingReturn } from '@/lib/catalog/shoppingReturn';
import { describePrice, quantityNoun, resolveSellingFormat, type SellingFormatSource } from '@/lib/storefrontCopy/sellingFormat';
import { minimumChip } from '@/lib/storefrontCopy/quantityRuleCopy';
import { AVAILABILITY_COPY, belowMinimumDetail } from '@/lib/storefrontCopy/availability';
import { AvailabilityBadge } from './AvailabilityBadge';
import { ProductPrice } from './ProductPrice';
import { FulfillmentPolicyChip } from './FulfillmentPolicyChip';
import { UnavailableRibbon } from './UnavailableRibbon';
import { normalizeFulfillmentPolicy } from '@/lib/fulfillment/fulfillmentPolicy';
import { hasValidPromotion } from '@/lib/catalog/promotions';
import { useCartLineQuantity } from '@/lib/cart/useCartLineQuantity';
import { CartStepper } from '@/components/cart/CartStepper';
import { QuantityGroupChip } from '@/components/cart/QuantityGroupChip';
import { PromoBadge } from './PromoBadge';
import { NoveltyBadge } from './NoveltyBadge';
import { promotionEndLabel } from '@/lib/catalog/promotions';
import { hasNoveltyBadge } from '@/lib/catalog/novelties';
import { buildSaleFormatOptions, type SaleFormatFields, type SaleFormatRow } from '@/lib/catalog/saleFormats';
import { bundleCaption, saleFormatCardChip, saleFormatOfferLine } from '@/lib/storefrontCopy/saleFormatCopy';
import { useFormatUnits } from '@/lib/cart/useFormatUnits';
import { FormatChooserDialog } from './FormatChooserDialog';
import { FormatPriceRiseNotice } from '@/components/cart/FormatPriceRiseNotice';

/**
 * Forme minimale requise par la card — satisfaite à la fois par
 * `ProductWithCategory` (grille catalogue) et `HomeProduct` (shelves home),
 * sans coupler le composant à l'un des deux types d'origine.
 */
export interface ProductCardProduct extends SellingFormatSource, SaleFormatFields {
  id: string;
  name: string;
  slug: string;
  price: number;
  compare_at_price?: number | null;
  image_url: string | null;
  /** Poids logistique (expédition, cartons) : jamais affiché comme quantité vendue. */
  weight_grams: number | null;
  stock: number | null;
  storage_type?: 'dry' | 'fresh' | 'frozen' | null;
  category?: { name: string } | null;
  /**
   * Obligatoires (pas `?:`) — volontairement : toute fonction qui construit
   * un `ProductCardProduct` doit fournir explicitement la règle de quantité
   * minimale du produit (migration 121), jamais l'oublier silencieusement.
   * Une source de données qui n'a pas encore la règle passe `1` (aucune
   * contrainte), jamais `undefined`.
   */
  min_order_quantity: number;
  order_quantity_step: number;
  /**
   * Mode de réception (migration 155). Obligatoire pour la même raison que la
   * règle de quantité : un produit « retrait uniquement » se voit avant l'ajout.
   * Une source sans la colonne passe `'delivery_or_pickup'`.
   */
  fulfillment_policy: ProductFulfillmentPolicy;
  /** Promotion programmée en cours et sa fin (migration 156) ; absent = aucune fin annoncée. */
  promo_applied?: boolean | null;
  promo_ends_at?: string | null;
  promo_until_sold_out?: boolean | null;
  /** Nouveauté jusqu'à cette date (migration 156). */
  new_until?: string | null;
  /** Formats de vente actifs de la fiche (migration 187, `sale_formats`) ; absent ou vide = format unique. */
  formats?: SaleFormatRow[] | null;
  /** Format en promotion montré dans « Nos promos » : sa card mène à la fiche mère (`getActivePromotions`). */
  format_parent_slug?: string | null;
}

interface ProductCardProps {
  product: ProductCardProduct;
  /** `grid` = grille catalogue (CTA explicite pour le shop, catégorie/poids visibles).
   *  `shelf` = shelf horizontale home (carte étroite, bouton "+" flottant). */
  variant?: 'grid' | 'shelf';
  /** Densité mobile réservée à la grille Catalogue ; Home conserve ses proportions. */
  compactMobile?: boolean;
  catalogScope?: CatalogScope;
  /**
   * Ouvre la confirmation d'ajout (défaut). Faux sur le panier : le produit
   * apparaît déjà dans la liste et le total, le client reste où il est.
   */
  confirmOnAdd?: boolean;
  /** Après un ajout réussi depuis le bouton de la carte (mesure de l'emplacement d'une suggestion). */
  onAdded?: (product: ProductCardProduct) => void;
  /** « Ça rentre dans votre colis » : le choix du format dit si chaque format garde la livraison inchangée. */
  shippingHeadroomG?: number | null;
}

const STORAGE_TAG_LABELS: Record<'dry' | 'fresh' | 'frozen', string> = {
  fresh:  'Frais',
  frozen: 'Surgelé',
  dry:    'Épicerie',
};

/** Contenu du cartellino Home — dérivé d'un champ produit réel, jamais une chaîne
 *  fixe identique pour tous les produits. Priorité au type de conservation,
 *  repli sur le nom de catégorie, aucun tag affiché si ni l'un ni l'autre
 *  n'est disponible. */
function getTagLabel(product: ProductCardProduct): string | null {
  if (product.storage_type) return STORAGE_TAG_LABELS[product.storage_type];
  if (product.category?.name) return product.category.name;
  return null;
}

/** Badge Catalogue : uniquement les états de conservation qui influencent
 *  réellement l'achat. `dry` et les catégories ne sont jamais badgés. */
function getGridStorageLabel(product: ProductCardProduct): 'Frais' | 'Surgelé' | null {
  if (product.storage_type === 'fresh') return 'Frais';
  if (product.storage_type === 'frozen') return 'Surgelé';
  return null;
}

export function ProductCard({ product, variant = 'grid', compactMobile = false, catalogScope = 'shop', confirmOnAdd = true, onAdded, shippingHeadroomG }: ProductCardProps) {
  const { currency } = useTenant();
  const merchandise = catalogScope === 'gadgets';
  const { addToCart, added, outOfStock, atLimit, availability } = useQuickAdd(product, !merchandise);
  const showConfirmation = useAddToCartUiStore(s => s.show);
  const line = useCartLineQuantity(product.id);
  // Formats de vente (187) : une seule card, choix explicite du format (jamais un lot par surprise).
  const formatOptions = merchandise ? [] : buildSaleFormatOptions(product);
  const multiFormat = formatOptions.length > 0;
  const purchasableFormats = formatOptions.filter((option) => option.purchasable);
  // Un seul format achetable et c'est la base : la card reste un ajout direct.
  const choosesFormat = multiFormat && !(purchasableFormats.length === 1 && purchasableFormats[0]!.isBase);
  const [formatDialogOpen, setFormatDialogOpen] = useState(false);
  // Une fois dans le panier : un seul compteur en unités de base, recomposé
  // automatiquement (3 paquets → 1 lot ; 1 lot − 1 → 2 paquets).
  const formatUnits = useFormatUnits(product, formatOptions);
  const offerLine = multiFormat ? saleFormatOfferLine(formatOptions, currency) : null;
  const ctaRef = useRef<HTMLButtonElement>(null);
  const stepperRef = useRef<HTMLDivElement>(null);
  const focusStepperAfterAdd = useRef(false);
  const tagLabel = merchandise ? product.category?.name : getTagLabel(product);
  const gridStorageLabel = getGridStorageLabel(product);
  const compactGrid = variant === 'grid' && compactMobile;
  const hasDiscount = hasValidPromotion(product);
  // Fin annoncée d'une promotion programmée (« Jusqu'au ven. 31 oct. », « … ou épuisement des stocks »).
  const promoEnd = promotionEndLabel(product);
  // Goodies : pas de nouveautés boutique (même règle que les promotions du catalogue).
  const showNovelty = !merchandise && hasNoveltyBadge(product);
  const savings = hasDiscount ? (product.compare_at_price as number) - product.price : 0;
  const sellingFormat = resolveSellingFormat(product);
  // Legacy: pack quantities from the explicit product name, only while the
  // structured selling format (migration 154) is not filled in. Never from weight.
  const cartonMatch = !merchandise && sellingFormat.source !== 'structured'
    ? product.name.match(/carton de (\d+) paquets\s*\((\d+) bâtons\)/i)
    : null;
  const cartonDetail = cartonMatch ? `${cartonMatch[1]} paquets · ${cartonMatch[2]} bâtons` : null;
  const displayName = cartonMatch ? product.name.split(/\s*[—–-]\s*carton de/i)[0] : product.name;
  const minOrderQuantity = product.min_order_quantity ?? 1;
  const hasMinRule = !merchandise && !multiFormat && minOrderQuantity > 1;
  const unavailable = multiFormat ? purchasableFormats.length === 0 : availability === 'sold_out' || availability === 'below_minimum';
  // Seuls les modes imposés sont mentionnés sur la card : le cas standard
  // (« Livraison ou retrait ») est dit sur la fiche produit, sans charger la grille.
  const fulfillmentPolicy = normalizeFulfillmentPolicy(product.fulfillment_policy);
  const showFulfillment = !merchandise && fulfillmentPolicy !== 'delivery_or_pickup';
  const shelfPrice = describePrice(product.price, sellingFormat, currency);
  const ctaLabel = added
    ? 'Ajouté ✓'
    : choosesFormat && !unavailable
      ? 'Choisir le format'
    : unavailable
      ? AVAILABILITY_COPY.unavailableCta
      : atLimit
        ? AVAILABILITY_COPY.atLimitCta
        : hasMinRule ? `Ajouter ${minOrderQuantity}` : 'Ajouter au panier';
  const ctaAriaLabel = choosesFormat && !unavailable
    ? `${product.name} : choisir le format`
    : unavailable
    ? `${product.name} : ${AVAILABILITY_COPY.unavailableCta.toLowerCase()}`
    : atLimit
      ? `${product.name} : ${AVAILABILITY_COPY.atLimitHelp}`
      : hasMinRule ? `Ajouter ${minOrderQuantity} au panier` : 'Ajouter au panier';

  // Une fois dans le panier, la card montre le même +/− que le panier (hors Goodies).
  // `line` est lu après l'hydratation : le HTML serveur (panier inconnu) reste identique au premier rendu.
  const showStepper = !merchandise && !unavailable && (multiFormat ? formatUnits.units > 0 : !choosesFormat && line.quantity > 0);
  // Plusieurs formats : l'unité dans le compteur (« paquets »), la composition
  // en dessous sur sa propre ligne (jamais tronquée dans une card étroite).
  const stepperCaption = multiFormat
    ? (formatUnits.canIncrement ? quantityNoun(sellingFormat, formatUnits.units) ?? 'dans le panier' : 'maximum disponible')
    : line.canIncrement ? 'dans le panier' : 'maximum disponible';
  const formatCaption = multiFormat && formatUnits.units > 0 ? bundleCaption(formatUnits.current, formatOptions, sellingFormat, currency) : null;
  const priceRiseNotice = multiFormat && (
    <FormatPriceRiseNotice rise={formatUnits.priceRise} sellingFormat={sellingFormat} currency={currency}
      onKeep={formatUnits.keepUnits} onConfirm={formatUnits.confirmDecrement} className="mt-1.5" />
  );
  const formatCaptionLine = formatCaption && formatCaption !== 'dans le panier' && (
    <p aria-live="polite" className={`mt-1 text-xs font-semibold leading-snug ${formatUnits.current && formatUnits.current.savings > 0 ? 'text-green-800' : 'text-gray-700'}`}>{formatCaption}</p>
  );

  // Le bouton « Ajouter » disparaît au profit du +/− : le focus clavier le suit
  // (avant que la confirmation ne l'enregistre pour le lui rendre à la fermeture).
  useEffect(() => {
    if (!showStepper || !focusStepperAfterAdd.current) return;
    focusStepperAfterAdd.current = false;
    const buttons = stepperRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
    buttons?.[buttons.length - 1]?.focus({ preventScroll: true });
  }, [showStepper]);

  function handleStepperDecrement() {
    const result = multiFormat ? formatUnits.decrement() : line.decrement();
    if (result === 'removed') requestAnimationFrame(() => ctaRef.current?.focus({ preventScroll: true }));
  }

  const stepper = (
    <CartStepper
      variant="card"
      quantity={multiFormat ? formatUnits.units : line.quantity}
      productName={product.name}
      removesOnDecrement={multiFormat ? formatUnits.removesOnDecrement : line.removesOnDecrement}
      canIncrement={multiFormat ? formatUnits.canIncrement : line.canIncrement && !atLimit}
      caption={stepperCaption}
      onIncrement={multiFormat ? formatUnits.increment : line.increment}
      onDecrement={handleStepperDecrement}
    />
  );

  function handleAddToCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (choosesFormat) {
      setFormatDialogOpen(true);
      return;
    }
    // Même confirmation pour toute card (grille, shelf, Goodies) : actions
    // « Voir mon panier » / « Continuer mes achats » qui ne disparaissent pas.
    if (addToCart()) {
      (e.currentTarget as HTMLElement).focus({ preventScroll: true });
      focusStepperAfterAdd.current = !merchandise;
      if (confirmOnAdd) showConfirmation(product);
      onAdded?.(product);
    }
  }

  // Measured grid card widths: ~44vw up to 640px, ~30vw to 767px, 234px to 1279px, 266px above.
  const imageSizes = variant === 'grid'
    ? '(max-width: 640px) 45vw, (max-width: 767px) 31vw, (max-width: 1279px) 236px, 268px'
    : '(max-width: 768px) 144px, 200px';

  return (
    <Link
      href={`/products/${product.format_parent_slug ?? product.slug}${merchandise ? '?from=gadgets' : ''}`}
      onClick={() => rememberShoppingReturn(window.location)}
      className={
        variant === 'grid'
          ? 'group relative block min-w-0'
          : 'group relative block flex-shrink-0 w-36 md:w-full md:flex-shrink'
      }
    >
      {variant === 'shelf' && tagLabel && (
        <ShopTag className="absolute -top-2 left-3 z-10">
          {tagLabel}
        </ShopTag>
      )}

      <div
        className={
          variant === 'grid'
            ? merchandise ? 'rounded-2xl overflow-hidden border border-gray-100 bg-white shadow-sm transition-all group-hover:shadow-card' : 'rounded-lg overflow-hidden border border-gray-200 group-hover:border-gray-300 transition-all group-hover:shadow-card'
            : 'rounded-lg overflow-hidden border border-gray-100 bg-white'
        }
      >
        <div className={`${compactGrid && !merchandise ? 'aspect-[4/3] sm:aspect-square' : 'aspect-square'} bg-primary-light relative overflow-hidden`}>
          {((variant === 'grid' && !merchandise && gridStorageLabel) || showNovelty) && (
            <div className={`absolute left-2 z-10 flex flex-col items-start gap-1 ${variant === 'shelf' && tagLabel ? 'top-5' : 'top-2'}`}>
              {showNovelty && <NoveltyBadge product={product} size={variant === 'shelf' ? 'sm' : 'md'} />}
              {variant === 'grid' && !merchandise && gridStorageLabel && (
                <span className="inline-flex items-center gap-1 rounded-full border border-gray-200/90 bg-white/95 px-2 py-1 text-xs font-semibold text-gray-800 shadow-sm">
                  {gridStorageLabel === 'Surgelé' && (
                    <IconSnowflake size={13} aria-hidden="true" className="shrink-0" />
                  )}
                  {gridStorageLabel}
                </span>
              )}
            </div>
          )}

          {hasDiscount && !unavailable && (
            <PromoBadge product={product} size={variant === 'shelf' ? 'sm' : 'md'} className="absolute right-2 top-2 z-10" />
          )}

          {product.image_url ? (
            <LepefyImage
              src={product.image_url}
              variant="catalog"
              alt={product.name}
              fill
              className={`${merchandise ? 'object-contain p-2 bg-gray-50' : 'object-cover'} group-hover:scale-105 transition-transform duration-300 ${unavailable ? 'opacity-70' : ''}`}
              sizes={imageSizes}
            />
          ) : variant === 'grid' ? (
            <div className="w-full h-full flex items-center justify-center text-gray-300">
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-3xl">🛒</span>
            </div>
          )}
          {unavailable && <UnavailableRibbon />}
        </div>

        {variant === 'grid' ? (
          <div className={compactGrid ? 'p-2.5 sm:p-3' : 'p-3'}>
            <p className={`font-medium text-gray-900 line-clamp-2 mb-1 ${compactGrid ? 'min-h-[2.05rem] text-[13px] leading-[1.25] sm:min-h-0 sm:text-sm sm:leading-normal' : 'text-sm'}`}>{displayName}</p>
            {cartonDetail && <p className="mb-1.5 text-xs font-semibold leading-snug text-gray-700">{cartonDetail}</p>}
            {showFulfillment && <FulfillmentPolicyChip policy={fulfillmentPolicy} className="mb-1.5" />}
            {merchandise && product.category?.name && <p className="mb-2 truncate text-xs text-gray-500">{product.category.name}</p>}
            <div className={`flex items-end justify-between gap-2 ${merchandise ? 'flex-wrap' : ''}`}>
              <div className="min-w-0">
                <ProductPrice price={product.price} currency={currency} product={product} compareAtPrice={product.compare_at_price} />
                {hasDiscount && !multiFormat && <p className="mt-1 text-xs font-semibold leading-snug text-red-700">Économisez {formatPrice(savings, currency)}</p>}
                {promoEnd && !unavailable && <p className="mt-0.5 text-xs font-semibold leading-snug text-red-900">{promoEnd}</p>}
              </div>
              {merchandise && <button
                onClick={handleAddToCart}
                aria-label="Ajouter au panier"
                disabled={outOfStock || atLimit}
                className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-white text-base font-bold transition-all active:scale-90 disabled:opacity-40"
                style={{ backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}
              >
                {added ? '✓' : merchandise ? <IconShoppingCart size={18} aria-hidden="true" /> : '+'}
              </button>}
            </div>
            {hasMinRule && !unavailable && (
              <p className="mt-2 flex items-start gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-1 text-xs font-semibold leading-snug text-amber-900">
                <IconInfoCircle size={14} aria-hidden="true" className="mt-px shrink-0" />
                <span>{minimumChip(minOrderQuantity, product.price, currency)}</span>
              </p>
            )}
            {multiFormat && (offerLine ? (
              <p className="mt-2 rounded-md border border-green-300 bg-green-50 px-1.5 py-1 text-xs font-bold leading-snug text-green-900">{offerLine}</p>
            ) : (
              <p className="mt-2 rounded-md border border-orange-200 bg-orange-50 px-1.5 py-1 text-xs font-semibold leading-snug text-orange-900">
                {saleFormatCardChip(formatOptions, currency)}
              </p>
            ))}
            {/* Groupe à mélanger (ex. Boissons, 12 minimum tous produits confondus). */}
            {!merchandise && !unavailable && <QuantityGroupChip productId={product.id} className="mt-2" />}
            {!merchandise && !multiFormat && availability === 'below_minimum' && (
              <p className="mt-2 text-xs leading-snug text-gray-700">{belowMinimumDetail(minOrderQuantity)}</p>
            )}
            {showStepper && <div ref={stepperRef} className="mt-2">{stepper}{formatCaptionLine}{priceRiseNotice}</div>}
            {!merchandise && !showStepper && (
              <button
                ref={ctaRef}
                type="button"
                onClick={handleAddToCart}
                disabled={unavailable || (atLimit && !choosesFormat)}
                aria-disabled={(atLimit && !choosesFormat) || undefined}
                aria-label={ctaAriaLabel}
                className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg px-1 py-2 text-[13px] font-semibold leading-tight whitespace-nowrap text-white transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:!bg-gray-200 disabled:text-gray-700 sm:text-sm motion-reduce:transition-none"
                style={choosesFormat && !unavailable
                  ? { backgroundColor: 'white', color: 'var(--color-primary)', boxShadow: 'inset 0 0 0 1.5px var(--color-primary)' }
                  : { backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}
              >
                {ctaLabel}
              </button>
            )}
            {!merchandise && !choosesFormat && atLimit && !unavailable && !showStepper && (
              <p className="mt-1.5 text-xs leading-snug text-gray-700">{AVAILABILITY_COPY.atLimitHelp}</p>
            )}
          </div>
        ) : (
          <div className="px-2 pt-1 pb-6">
            <p className="text-xs font-medium line-clamp-2 text-gray-900">{product.name}</p>
            <p className="mt-0.5 leading-tight" aria-label={`${shelfPrice.amount} ${shelfPrice.unitPhrase}${hasDiscount ? `, au lieu de ${formatPrice(product.compare_at_price as number, currency)}` : ''}`}>
              <span aria-hidden="true" className="text-sm font-bold text-gray-950">{shelfPrice.amount}</span>{' '}
              <span aria-hidden="true" className="text-xs font-medium text-gray-700">{shelfPrice.unitPhrase}</span>
              {hasDiscount && (
                <span aria-hidden="true" className="ml-1 text-xs font-medium text-gray-600 line-through">{formatPrice(product.compare_at_price as number, currency)}</span>
              )}
            </p>
            {promoEnd && !unavailable && <p className="mt-0.5 text-xs font-semibold leading-snug text-red-900">{promoEnd}</p>}
            {multiFormat && !unavailable && (
              <span className="mt-1 inline-flex items-center rounded-md border border-green-300 bg-green-50 px-1.5 py-0.5 text-xs font-bold leading-tight text-green-900">
                {offerLine ?? `${formatOptions.length} formats`}
              </span>
            )}
            {hasMinRule && (
              <span className="mt-1 inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold leading-tight text-amber-900">
                {minOrderQuantity} minimum
              </span>
            )}
            {showFulfillment && <FulfillmentPolicyChip policy={fulfillmentPolicy} className="mt-1" />}
            {unavailable && <AvailabilityBadge state={availability} className="mt-1" />}
            {showStepper && <div ref={stepperRef} className="mt-2">{stepper}{formatCaptionLine}{priceRiseNotice}</div>}
          </div>
        )}
      </div>

      {variant === 'shelf' && !showStepper && (
        <button
          ref={ctaRef}
          onClick={handleAddToCart}
          aria-label={ctaAriaLabel}
          disabled={unavailable || (atLimit && !choosesFormat)}
          className="absolute bottom-2 right-2 w-11 h-11 rounded-full flex items-center justify-center text-white text-base font-bold transition-all active:scale-90 shadow-card disabled:cursor-not-allowed disabled:!bg-gray-300 disabled:text-gray-700"
          style={{ backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}
        >
          {added ? '✓' : '+'}
        </button>
      )}
      {multiFormat && (
        <FormatChooserDialog
          open={formatDialogOpen}
          product={product}
          options={formatOptions}
          onClose={() => setFormatDialogOpen(false)}
          shippingHeadroomG={shippingHeadroomG}
          onAddUnits={(option) => {
            const added = formatUnits.addUnits(option.units * option.minimum);
            if (added) {
              focusStepperAfterAdd.current = true;
              // Même confirmation qu'un ajout direct (« Voir mon panier », suggestions).
              if (confirmOnAdd) showConfirmation(product);
              onAdded?.(product);
            }
            return added;
          }}
        />
      )}
    </Link>
  );
}
