import Image from 'next/image';
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
    <li className={`flex gap-3 border-b border-gray-100 last:border-0 ${isPage ? 'py-4 sm:gap-4 sm:py-5' : 'py-4'}`}>
      <div className={`${isPage ? 'h-20 w-20 sm:h-[88px] sm:w-[88px]' : 'h-16 w-16'} relative flex-shrink-0 overflow-hidden rounded-2xl bg-gray-50`}>
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes={isPage ? '(min-width: 640px) 88px, 80px' : '64px'}
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-300">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={`${isPage ? 'text-[15px] sm:text-base' : 'text-sm'} line-clamp-2 font-semibold leading-snug text-gray-950`}>{product.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
              {weightLabel && <span>{weightLabel}</span>}
              <span>{formatPrice(product.price, currency)} / unité</span>
              {(state === 'unavailable' || state === 'out_of_stock') && (
                <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                  {isPage ? 'Produit actuellement indisponible' : STATE_BADGE[state]}
                </span>
              )}
            </div>
          </div>
          {isPage && (
            <span className="hidden shrink-0 text-base font-bold tabular-nums sm:block" aria-live="polite">
              {formatPrice(lineTotal, currency)}
            </span>
          )}
        </div>

        <div className={`${isPage ? 'mt-3' : 'mt-2'} flex items-center justify-between gap-3`}>
          <div className="flex items-center gap-1.5">
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
          <span className={`${isPage ? 'text-base sm:hidden' : 'text-sm'} font-bold tabular-nums`} aria-live="polite">
            {formatPrice(lineTotal, currency)}
          </span>
        </div>

        <button
          type="button"
          onClick={() => onRemove(product.id)}
          className="-ml-2 mt-1 inline-flex min-h-10 items-center rounded px-2 text-xs font-medium text-gray-500 transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          Retirer
        </button>
      </div>
    </li>
  );
}
