import Image from 'next/image';
import Link from 'next/link';
import { IconArrowUpRight } from '@tabler/icons-react';
import type { CartItem as CartItemType } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';
import { deriveCartItemState } from '@/lib/cart/cartItemState';
import { CartQuantityControl } from './CartQuantityControl';

interface CartItemProps {
  item: CartItemType;
  currency?: string;
  unavailableProductIds: string[];
  pendingProductIds: Set<string>;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onRemove: (productId: string) => void;
  variant?: 'drawer' | 'page';
}

function formatWeightLabel(grams: number | null): string | null {
  if (!grams) return null;
  return grams >= 1000 ? `${+(grams / 1000).toFixed(2)}kg` : `${grams}g`;
}

const STATE_BADGE: Record<'unavailable' | 'out_of_stock', string> = {
  unavailable: 'Indisponible',
  out_of_stock: 'Épuisé',
};

export function CartItem({
  item,
  currency,
  unavailableProductIds,
  pendingProductIds,
  onIncrement,
  onDecrement,
  onRemove,
  variant = 'drawer',
}: CartItemProps) {
  const { product, quantity } = item;
  const state = deriveCartItemState({
    productId: product.id,
    stock: product.stock,
    unavailableProductIds,
    pendingProductIds,
  });
  const blocked = state === 'unavailable' || state === 'out_of_stock';
  const weightLabel = formatWeightLabel(product.weight_grams);
  const lineTotal = product.price * quantity;
  const isPage = variant === 'page';

  return (
    <li
      className={isPage
        ? 'group relative flex gap-3 overflow-hidden rounded-3xl border border-gray-200 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary)_5%,white),white_58%)] p-3.5 shadow-[0_6px_22px_rgba(15,23,42,0.045)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--color-primary)_32%,#d1d5db)] hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)] sm:gap-4 sm:p-4 motion-reduce:transform-none motion-reduce:transition-none'
        : 'flex gap-4 border-b border-gray-100 py-4 last:border-0'}
    >
      {isPage && (
        <>
          <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-[var(--color-primary)] opacity-70" aria-hidden="true" />
          <Link
            href={`/products/${product.slug}`}
            aria-label={`Voir le produit ${product.name}`}
            className="absolute inset-0 z-0 rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)]"
          />
        </>
      )}

      <div className={`${isPage ? 'h-24 w-24 sm:h-[104px] sm:w-[104px]' : 'h-16 w-16'} relative z-10 flex-shrink-0 overflow-hidden rounded-2xl bg-gray-50 ring-1 ring-black/5 shadow-sm transition-transform duration-200 group-hover:scale-[1.015] motion-reduce:transition-none motion-reduce:transform-none pointer-events-none`}>
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes={isPage ? '(min-width: 640px) 104px, 96px' : '64px'}
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[color-mix(in_srgb,var(--color-primary)_4%,#f9fafb)] text-gray-300">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>

      <div className="relative z-10 min-w-0 flex-1 pointer-events-none">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`${isPage ? 'text-[15px] sm:text-base' : 'text-sm'} line-clamp-2 font-bold leading-snug text-gray-950`}>{product.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
              {weightLabel && <span>{weightLabel}</span>}
              <span className="font-medium">{formatPrice(product.price, currency)} / unité</span>
              {(state === 'unavailable' || state === 'out_of_stock') && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                  {isPage ? 'Produit actuellement indisponible' : STATE_BADGE[state]}
                </span>
              )}
            </div>
            {isPage && (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-[var(--color-primary)] ring-1 ring-black/5 shadow-sm">
                Voir le produit
                <IconArrowUpRight size={13} aria-hidden="true" />
              </span>
            )}
          </div>
          {isPage && (
            <span className="hidden shrink-0 rounded-xl bg-white/85 px-2.5 py-1.5 text-base font-bold tabular-nums text-gray-950 ring-1 ring-black/5 shadow-sm sm:block" aria-live="polite">
              {formatPrice(lineTotal, currency)}
            </span>
          )}
        </div>

        <div className={`${isPage ? 'mt-3' : 'mt-2'} flex items-center justify-between gap-3`}>
          <div className="relative z-20 flex items-center gap-1.5 pointer-events-auto">
            <CartQuantityControl
              quantity={quantity}
              max={Math.max(product.stock, 0)}
              productName={product.name}
              disabled={blocked}
              onIncrement={() => onIncrement(product.id)}
              onDecrement={() => onDecrement(product.id)}
            />
            {state === 'pending' && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300 motion-reduce:animate-none" aria-hidden="true" />
            )}
          </div>
          <span className={`${isPage ? 'text-base sm:hidden' : 'text-sm'} rounded-lg bg-white/80 px-2 py-1 font-bold tabular-nums ring-1 ring-black/5`} aria-live="polite">
            {formatPrice(lineTotal, currency)}
          </span>
        </div>

        <button
          type="button"
          onClick={() => onRemove(product.id)}
          className="relative z-20 -ml-2 mt-1 inline-flex min-h-10 items-center rounded px-2 text-xs font-medium text-gray-500 transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 pointer-events-auto"
        >
          Retirer
        </button>
      </div>
    </li>
  );
}
