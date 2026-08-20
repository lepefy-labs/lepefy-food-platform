'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useCartStore } from '@/stores/cartStore';
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
}

const STORAGE_TAG_LABELS: Record<'dry' | 'fresh' | 'frozen', string> = {
  fresh:  'Frais',
  frozen: 'Surgelé',
  dry:    'Épicerie',
};

/** Contenu du cartellino — dérivé d'un champ produit réel, jamais une chaîne
 *  fixe identique pour tous les produits. Priorité au type de conservation
 *  (le plus proche du concept "étiquette de fraîcheur"), repli sur le nom de
 *  catégorie, aucun tag affiché si ni l'un ni l'autre n'est disponible. */
function getTagLabel(product: ProductCardProduct): string | null {
  if (product.storage_type) return STORAGE_TAG_LABELS[product.storage_type];
  if (product.category?.name) return product.category.name;
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

export function ProductCard({ product, variant = 'grid' }: ProductCardProps) {
  const { currency } = useTenant();
  const addItem = useCartStore((s) => s.addItem);
  const outOfStock = product.stock === 0;
  const [added, setAdded] = useState(false);
  const tagLabel = getTagLabel(product);
  const detailLine = getDetailLine(product);
  const hasDiscount = product.compare_at_price != null && product.compare_at_price > product.price;
  const discountPercent = hasDiscount
    ? Math.round((1 - product.price / (product.compare_at_price as number)) * 100)
    : null;

  function handleAddToCart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (outOfStock) return;
    addItem({
      id:           product.id,
      name:         product.name,
      slug:         product.slug,
      price:        product.price,
      image_url:    product.image_url,
      weight_grams: product.weight_grams,
      stock:        product.stock ?? 999,
      storage_type: product.storage_type ?? null,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  const imageSizes = variant === 'grid'
    ? '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw'
    : '(max-width: 768px) 144px, 200px';

  return (
    <Link
      href={`/products/${product.slug}`}
      className={
        variant === 'grid'
          ? 'group relative block'
          : 'group relative block flex-shrink-0 w-36 md:w-full md:flex-shrink'
      }
    >
      {tagLabel && (
        <ShopTag className={variant === 'grid' ? 'absolute -top-2.5 left-3 z-10' : 'absolute -top-2 left-3 z-10'}>
          {tagLabel}
        </ShopTag>
      )}

      <div
        className={
          variant === 'grid'
            ? 'rounded-lg overflow-hidden border border-gray-200 group-hover:border-gray-300 transition-all group-hover:shadow-card'
            : 'rounded-lg overflow-hidden border border-gray-100 bg-white'
        }
      >
        <div className="aspect-square bg-primary-light relative overflow-hidden">
          {variant === 'grid' && discountPercent != null && (
            <span className="absolute right-2 top-2 z-10 rounded-md bg-white/95 px-1.5 py-1 text-xs font-bold text-gray-900 shadow-sm">−{discountPercent}%</span>
          )}
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={product.name}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
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
          <div className="p-3">
            <p className="text-sm font-medium text-gray-900 line-clamp-2 mb-1">{product.name}</p>
            {detailLine && <p className="text-xs text-gray-400 mb-2">{detailLine}</p>}
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <span className="block text-base font-bold leading-tight" style={{ color: 'var(--color-primary)' }}>{formatPrice(product.price, currency)}</span>
                {hasDiscount && <span className="block text-xs text-gray-400 line-through">{formatPrice(product.compare_at_price as number, currency)}</span>}
              </div>
              <button
                onClick={handleAddToCart}
                aria-label="Ajouter au panier"
                disabled={outOfStock}
                className="w-11 h-11 rounded-full flex items-center justify-center text-white text-base font-bold transition-all active:scale-90 disabled:opacity-40"
                style={{ backgroundColor: added ? '#16a34a' : 'var(--color-primary)' }}
              >
                {added ? '✓' : '+'}
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
