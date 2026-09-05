'use client';
import Link from 'next/link';
import Image from 'next/image';
import { IconSnowflake, IconShoppingCart } from '@tabler/icons-react';
import type { CatalogScope } from '@lepefy/types';
import { useQuickAdd } from './useQuickAdd';
import { formatPrice } from '@/lib/utils/format';
import { useTenant } from '@/providers/TenantProvider';
import { ShopTag } from '@/components/ui/ShopTag';

/**
 * Forme minimale requise par la card — satisfaite à la fois par
 * `ProductWithCategory` (grille catalogue) et `HomeProduct` (shelves home),
 * sans coupler le composant à l'un des deux types d'origine.
 */
export interface ProductCardProduct {
  id: string;
  name: string;
  slug: string;
  price: number;
  compare_at_price?: number | null;
  image_url: string | null;
  weight_grams: number | null;
  stock: number | null;
  storage_type?: 'dry' | 'fresh' | 'frozen' | null;
  category?: { name: string } | null;
}

interface ProductCardProps {
  product: ProductCardProduct;
  /** `grid` = grille catalogue (bouton "+" circulaire, catégorie/poids visibles).
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

/** Équivalent réel de la ligne "origine" du mockup (ex. "Cameroun · 1kg") —
 *  la provenance n'existe pas dans le schéma produit, donc pas de valeur
 *  inventée : on compose catégorie + poids, les deux seuls champs réels
 *  disponibles pour ce rôle. */
function formatWeightLabel(grams: number | null): string | null {
  if (!grams) return null;
  return grams >= 1000 ? `${+(grams / 1000).toFixed(2)}kg` : `${grams}g`;
}

function getDetailLine(product: ProductCardProduct): string | null {
  const parts = [product.category?.name, formatWeightLabel(product.weight_grams)].filter(
    (v): v is string => Boolean(v),
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function ProductCard({ product, variant = 'grid', compactMobile = false, catalogScope = 'shop' }: ProductCardProps) {
  const { currency } = useTenant();
  const { addToCart, added, outOfStock } = useQuickAdd(product);
  const merchandise = catalogScope === 'gadgets';
  const tagLabel = merchandise ? product.category?.name : getTagLabel(product);
  const gridStorageLabel = getGridStorageLabel(product);
  const detailLine = merchandise ? product.category?.name : getDetailLine(product);
  const compactGrid = variant === 'grid' && compactMobile;
  const hasDiscount = product.compare_at_price != null && product.compare_at_price > product.price;
  const discountPercent = hasDiscount
    ? Math.round((1 - product.price / (product.compare_at_price as number)) * 100)
    : null;

  function handleAddToCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    addToCart();
  }

  const imageSizes = variant === 'grid'
    ? '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw'
    : '(max-width: 768px) 144px, 200px';

  return (
    <Link
      href={`/products/${product.slug}${merchandise ? '?from=gadgets' : ''}`}
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
            <span className={`absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full border border-gray-200/90 bg-white/95 font-semibold text-gray-800 shadow-sm ${compactGrid ? 'px-2 py-1 text-[11px] sm:text-xs' : 'px-2 py-1 text-xs'}`}>
              {gridStorageLabel === 'Surgelé' && (
                <IconSnowflake size={13} aria-hidden="true" className="shrink-0" />
              )}
              {gridStorageLabel}
            </span>
          )}

          {variant === 'grid' && discountPercent != null && (
            <span className={`absolute z-10 rounded-md bg-white/95 font-bold text-gray-900 shadow-sm ${compactGrid ? 'right-1.5 top-1.5 px-1 py-0.5 text-[11px] sm:right-2 sm:top-2 sm:px-1.5 sm:py-1 sm:text-xs' : 'right-2 top-2 px-1.5 py-1 text-xs'}`}>−{discountPercent}%</span>
          )}

          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={product.name}
              fill
              className={`${merchandise ? 'object-contain p-2 bg-gray-50' : 'object-cover'} group-hover:scale-105 transition-transform duration-300`}
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
          {outOfStock && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <span className="bg-white text-gray-700 text-xs font-medium px-2 py-1 rounded-sm">Épuisé</span>
            </div>
          )}
        </div>

        {variant === 'grid' ? (
          <div className={compactGrid ? 'p-2.5 sm:p-3' : 'p-3'}>
            <p className={`font-medium text-gray-900 line-clamp-2 mb-1 ${compactGrid ? 'min-h-[2.05rem] text-[13px] leading-[1.25] sm:min-h-0 sm:text-sm sm:leading-normal' : 'text-sm'}`}>{product.name}</p>
            {detailLine && <p className={`truncate text-xs text-gray-400 ${compactGrid ? 'mb-1.5 leading-tight sm:mb-2 sm:leading-normal' : 'mb-2'}`}>{detailLine}</p>}
            <div className={`flex items-end justify-between gap-2 ${merchandise ? 'flex-wrap' : ''}`}>
              <div className="min-w-0">
                <span className="block whitespace-nowrap text-base font-bold leading-tight" style={{ color: 'var(--color-primary)' }}>{formatPrice(product.price, currency)}</span>
                {hasDiscount && <span className="block text-xs text-gray-400 line-through">{formatPrice(product.compare_at_price as number, currency)}</span>}
              </div>
              <button
                onClick={handleAddToCart}
                aria-label="Ajouter au panier"
                disabled={outOfStock}
                className="w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-white text-base font-bold transition-all active:scale-90 disabled:opacity-40"
                style={{ backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}
              >
                {added ? '✓' : merchandise ? <IconShoppingCart size={18} aria-hidden="true" /> : '+'}
              </button>
            </div>
          </div>
        ) : (
          <div className="px-2 pt-1 pb-6">
            <p className="text-xs font-medium line-clamp-2 text-gray-900">{product.name}</p>
            <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--color-primary)' }}>
              {formatPrice(product.price, currency)}
            </p>
          </div>
        )}
      </div>

      {variant === 'shelf' && (
        <button
          onClick={handleAddToCart}
          aria-label="Ajouter au panier"
          disabled={outOfStock}
          className="absolute bottom-2 right-2 w-11 h-11 rounded-full flex items-center justify-center text-white text-base font-bold transition-all active:scale-90 shadow-card disabled:opacity-40"
          style={{ backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}
        >
          {added ? '✓' : '+'}
        </button>
      )}
    </Link>
  );
}
