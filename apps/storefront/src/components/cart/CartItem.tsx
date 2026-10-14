import { LepefyImage } from '@/components/images/LepefyImage';
import Link from 'next/link';
import { IconChevronRight } from '@tabler/icons-react';
import type { CartItem as CartItemType, ProductFulfillmentPolicy } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';
import { deriveCartItemState } from '@/lib/cart/cartItemState';
import { CartStepper } from './CartStepper';
import { decrementRemovesLine, getMaximumValidQuantity, stepPurchaseQuantity } from '@/lib/purchaseQuantityRules';
import { describePrice, formatCount, resolveSellingFormat } from '@/lib/storefrontCopy/sellingFormat';
import { cartLineIssue } from '@/lib/storefrontCopy/availability';
import { FulfillmentPolicyChip } from '@/components/catalog/FulfillmentPolicyChip';

interface CartItemProps {
  item: CartItemType;
  currency?: string;
  unavailableProductIds: string[];
  pendingProductIds: Set<string>;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onRemove: (productId: string) => void;
  /** Applique la quantité valide proposée par un problème de ligne (« Passer à 6 »). */
  onAdjust?: (productId: string, quantity: number) => void;
  variant?: 'drawer' | 'page';
  /** Mode de réception lu frais (panier) : seul un mode imposé est affiché. */
  fulfillmentPolicy?: ProductFulfillmentPolicy;
}


export function CartItem({
  item,
  currency,
  unavailableProductIds,
  pendingProductIds,
  onIncrement,
  onDecrement,
  onRemove,
  onAdjust,
  variant = 'drawer',
  fulfillmentPolicy,
}: CartItemProps) {
  const { product, quantity } = item;
  const state = deriveCartItemState({
    productId: product.id,
    stock: product.stock,
    unavailableProductIds,
    pendingProductIds,
  });
  const maxPurchasable = getMaximumValidQuantity(product.stock, product.min_order_quantity ?? 1, product.order_quantity_step ?? 1);
  const insufficientForPack = maxPurchasable === 0;
  const blocked = state === 'unavailable' || state === 'out_of_stock' || insufficientForPack;
  const sellingFormat = resolveSellingFormat(product);
  const price = describePrice(product.price, sellingFormat, currency);
  const issue = cartLineIssue({
    removed: state === 'unavailable',
    stock: product.stock,
    quantity,
    minimum: product.min_order_quantity ?? 1,
    step: product.order_quantity_step ?? 1,
    countLabel: (count) => formatCount(sellingFormat, count),
  });
  const minimum = product.min_order_quantity ?? 1;
  const step = product.order_quantity_step ?? 1;
  const canIncrement = stepPurchaseQuantity(quantity, minimum, step, product.stock, 'increment') !== null;
  const removesOnDecrement = decrementRemovesLine(quantity, minimum, step);
  const lineTotal = product.price * quantity;
  const isPage = variant === 'page';

  return (
    <li
      className={isPage
        ? 'group relative flex gap-3 overflow-hidden rounded-3xl border border-gray-200 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-primary)_5%,white),white_58%)] p-3 shadow-[0_5px_18px_rgba(15,23,42,0.04)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--color-primary)_32%,#d1d5db)] hover:shadow-[0_10px_26px_rgba(15,23,42,0.07)] sm:gap-4 sm:p-4 motion-reduce:transform-none motion-reduce:transition-none'
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

      <div className={`${isPage ? 'h-[88px] w-[88px] sm:h-24 sm:w-24' : 'h-16 w-16'} relative z-10 flex-shrink-0 overflow-hidden rounded-2xl bg-gray-50 ring-1 ring-black/5 shadow-sm transition-transform duration-200 group-hover:scale-[1.015] motion-reduce:transition-none motion-reduce:transform-none pointer-events-none`}>
        {product.image_url ? (
          <LepefyImage
            src={product.image_url}
            variant="thumbnail"
            alt={product.name}
            fill
            sizes={isPage ? '(min-width: 640px) 96px, 88px' : '64px'}
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
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-start gap-1">
              <p className={`${isPage ? 'text-[15px] sm:text-base' : 'text-sm'} line-clamp-2 font-bold leading-snug text-gray-950`}>{product.name}</p>
              {isPage && <IconChevronRight size={16} className="mt-0.5 shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />}
            </div>
            <p className="mt-1 text-xs text-gray-700">
              <span className="font-semibold">{price.amount}</span> {price.unitPhrase}
            </p>
            {fulfillmentPolicy && fulfillmentPolicy !== 'delivery_or_pickup' && (
              <FulfillmentPolicyChip policy={fulfillmentPolicy} className="mt-1.5" />
            )}
            {issue && (
              <p className={`mt-1.5 flex flex-wrap items-center gap-x-2 rounded-lg px-2 py-1 text-xs font-semibold leading-snug ${issue.kind === 'over_stock' || issue.kind === 'off_rule' ? 'bg-amber-50 text-amber-900' : 'bg-red-50 text-red-800'}`} role="status">
                <span>{issue.message}</span>
                {(issue.kind === 'over_stock' || issue.kind === 'off_rule') && onAdjust && (
                  <button
                    type="button"
                    onClick={() => onAdjust(product.id, issue.target)}
                    className="pointer-events-auto relative z-20 inline-flex min-h-9 items-center font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  >
                    Passer à {formatCount(sellingFormat, issue.target)}
                  </button>
                )}
              </p>
            )}
          </div>
          {isPage && (
            <span className="hidden shrink-0 rounded-xl bg-white/85 px-2.5 py-1.5 text-base font-bold tabular-nums text-gray-950 ring-1 ring-black/5 shadow-sm sm:block" aria-live="polite">
              {formatPrice(lineTotal, currency)}
            </span>
          )}
        </div>

        <div className={`${isPage ? 'mt-2.5' : 'mt-2'} flex flex-wrap items-center justify-between gap-x-3 gap-y-1`}>
          <div className="relative z-20 flex items-center gap-1.5 pointer-events-auto">
            <CartStepper
              quantity={quantity}
              productName={product.name}
              removesOnDecrement={removesOnDecrement}
              canIncrement={!blocked && canIncrement && quantity < maxPurchasable}
              disabled={state === 'unavailable'}
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
          className="relative z-20 -ml-2 mt-0.5 inline-flex min-h-9 items-center rounded px-2 text-xs font-medium text-gray-500 transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 pointer-events-auto"
        >
          Retirer
        </button>
      </div>
    </li>
  );
}
