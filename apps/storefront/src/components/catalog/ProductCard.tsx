'use client';
import Link from 'next/link';
import Image from 'next/image';
import { IconInfoCircle, IconSnowflake, IconShoppingCart } from '@tabler/icons-react';
import type { CatalogScope } from '@lepefy/types';
import { useAddToCartUiStore } from '@/stores/addToCartUiStore';
import { useQuickAdd } from './useQuickAdd';
import { formatPrice } from '@/lib/utils/format';
import { useTenant } from '@/providers/TenantProvider';
import { ShopTag } from '@/components/ui/ShopTag';
import { rememberShoppingReturn } from '@/lib/catalog/shoppingReturn';
import { describePrice, resolveSellingFormat, type SellingFormatSource } from '@/lib/storefrontCopy/sellingFormat';
import { minimumChip } from '@/lib/storefrontCopy/quantityRuleCopy';
import { AVAILABILITY_COPY, belowMinimumDetail } from '@/lib/storefrontCopy/availability';
import { AvailabilityBadge } from './AvailabilityBadge';
import { ProductPrice } from './ProductPrice';

/**
 * Forme minimale requise par la card — satisfaite à la fois par
 * `ProductWithCategory` (grille catalogue) et `HomeProduct` (shelves home),
 * sans coupler le composant à l'un des deux types d'origine.
 */
export interface ProductCardProduct extends SellingFormatSource {
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
}

interface ProductCardProps {
  product: ProductCardProduct;
  /** `grid` = grille catalogue (CTA explicite pour le shop, catégorie/poids visibles).
   *  `shelf` = shelf horizontale home (carte étroite, bouton "+" flottant). */
  variant?: 'grid' | 'shelf';
  /** Densité mobile réservée à la grille Catalogue ; Home conserve ses proportions. */
  compactMobile?: boolean;
  catalogScope?: CatalogScope;
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

export function ProductCard({ product, variant = 'grid', compactMobile = false, catalogScope = 'shop' }: ProductCardProps) {
  const { currency } = useTenant();
  const merchandise = catalogScope === 'gadgets';
  const { addToCart, added, outOfStock, atLimit, availability } = useQuickAdd(product, !merchandise);
  const showConfirmation = useAddToCartUiStore(s => s.show);
  const tagLabel = merchandise ? product.category?.name : getTagLabel(product);
  const gridStorageLabel = getGridStorageLabel(product);
  const compactGrid = variant === 'grid' && compactMobile;
  const hasDiscount = product.compare_at_price != null && product.compare_at_price > product.price;
  const savings = hasDiscount ? (product.compare_at_price as number) - product.price : 0;
  const sellingFormat = resolveSellingFormat(product);
  // Legacy: pack quantities from the explicit product name, only while the
  // structured selling format (migration 154) is not filled in. Never from weight.
  const cartonMatch = !merchandise && sellingFormat.source !== 'structured'
    ? product.name.match(/carton de (\d+) paquets\s*\((\d+) bâtons\)/i)
    : null;
  const cartonDetail = cartonMatch ? `${cartonMatch[1]} paquets · ${cartonMatch[2]} bâtons` : null;
  const displayName = cartonMatch ? product.name.split(/\s*[—–-]\s*carton de/i)[0] : product.name;
  const discountPercent = hasDiscount
    ? Math.round((1 - product.price / (product.compare_at_price as number)) * 100)
    : null;
  const minOrderQuantity = product.min_order_quantity ?? 1;
  const hasMinRule = !merchandise && minOrderQuantity > 1;
  const unavailable = availability === 'sold_out' || availability === 'below_minimum';
  const shelfPrice = describePrice(product.price, sellingFormat, currency);
  const ctaLabel = added
    ? 'Ajouté ✓'
    : unavailable
      ? AVAILABILITY_COPY.unavailableCta
      : atLimit
        ? AVAILABILITY_COPY.atLimitCta
        : hasMinRule ? `Ajouter ${minOrderQuantity}` : 'Ajouter au panier';
  const ctaAriaLabel = unavailable
    ? `${product.name} : ${AVAILABILITY_COPY.unavailableCta.toLowerCase()}`
    : atLimit
      ? `${product.name} : ${AVAILABILITY_COPY.atLimitHelp}`
      : hasMinRule ? `Ajouter ${minOrderQuantity} au panier` : 'Ajouter au panier';

  function handleAddToCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (addToCart() && variant === 'grid' && !merchandise) {
      (e.currentTarget as HTMLElement).focus({ preventScroll: true });
      showConfirmation(product);
    }
  }

  const imageSizes = variant === 'grid'
    ? '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw'
    : '(max-width: 768px) 144px, 200px';

  return (
    <Link
      href={`/products/${product.slug}${merchandise ? '?from=gadgets' : ''}`}
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
          {variant === 'grid' && !merchandise && gridStorageLabel && (
            <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full border border-gray-200/90 bg-white/95 px-2 py-1 text-xs font-semibold text-gray-800 shadow-sm">
              {gridStorageLabel === 'Surgelé' && (
                <IconSnowflake size={13} aria-hidden="true" className="shrink-0" />
              )}
              {gridStorageLabel}
            </span>
          )}

          {variant === 'grid' && discountPercent != null && !unavailable && (
            <span className="absolute bottom-2 left-2 right-2 z-10 rounded-lg bg-red-700 px-2 py-1.5 text-center text-xs font-bold leading-tight text-white shadow-sm">
              {cartonDetail ? `OFFRE CARTON · −${formatPrice(savings, currency)}` : `OFFRE · −${discountPercent}%`}
            </span>
          )}

          {product.image_url ? (
            <Image
              src={product.image_url}
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
          {unavailable && (
            <AvailabilityBadge state={availability} className="absolute bottom-2 left-2 right-2 z-10 justify-center text-center" />
          )}
        </div>

        {variant === 'grid' ? (
          <div className={compactGrid ? 'p-2.5 sm:p-3' : 'p-3'}>
            <p className={`font-medium text-gray-900 line-clamp-2 mb-1 ${compactGrid ? 'min-h-[2.05rem] text-[13px] leading-[1.25] sm:min-h-0 sm:text-sm sm:leading-normal' : 'text-sm'}`}>{displayName}</p>
            {cartonDetail && <p className="mb-1.5 text-xs font-semibold leading-snug text-gray-700">{cartonDetail}</p>}
            {merchandise && product.category?.name && <p className="mb-2 truncate text-xs text-gray-500">{product.category.name}</p>}
            <div className={`flex items-end justify-between gap-2 ${merchandise ? 'flex-wrap' : ''}`}>
              <div className="min-w-0">
                <ProductPrice price={product.price} currency={currency} product={product} compareAtPrice={product.compare_at_price} />
                {hasDiscount && <p className="mt-1 text-xs font-semibold leading-snug text-red-700">Économisez {formatPrice(savings, currency)}</p>}
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
            {!merchandise && availability === 'below_minimum' && (
              <p className="mt-2 text-xs leading-snug text-gray-700">{belowMinimumDetail(minOrderQuantity)}</p>
            )}
            {!merchandise && (
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={unavailable || atLimit}
                aria-disabled={atLimit || undefined}
                aria-label={ctaAriaLabel}
                className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg px-1 py-2 text-[13px] font-semibold leading-tight whitespace-nowrap text-white transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:!bg-gray-200 disabled:text-gray-700 sm:text-sm motion-reduce:transition-none"
                style={{ backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}
              >
                {ctaLabel}
              </button>
            )}
            {!merchandise && atLimit && !unavailable && (
              <p className="mt-1.5 text-xs leading-snug text-gray-700">{AVAILABILITY_COPY.atLimitHelp}</p>
            )}
          </div>
        ) : (
          <div className="px-2 pt-1 pb-6">
            <p className="text-xs font-medium line-clamp-2 text-gray-900">{product.name}</p>
            <p className="mt-0.5 leading-tight" aria-label={shelfPrice.sentence}>
              <span aria-hidden="true" className="text-sm font-bold text-gray-950">{shelfPrice.amount}</span>{' '}
              <span aria-hidden="true" className="text-xs font-medium text-gray-700">{shelfPrice.unitPhrase}</span>
            </p>
            {hasMinRule && (
              <span className="mt-1 inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold leading-tight text-amber-900">
                {minOrderQuantity} minimum
              </span>
            )}
            {unavailable && <AvailabilityBadge state={availability} className="mt-1" />}
          </div>
        )}
      </div>

      {variant === 'shelf' && (
        <button
          onClick={handleAddToCart}
          aria-label={ctaAriaLabel}
          disabled={unavailable || atLimit}
          className="absolute bottom-2 right-2 w-11 h-11 rounded-full flex items-center justify-center text-white text-base font-bold transition-all active:scale-90 shadow-card disabled:cursor-not-allowed disabled:!bg-gray-300 disabled:text-gray-700"
          style={{ backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}
        >
          {added ? '✓' : '+'}
        </button>
      )}
    </Link>
  );
}
