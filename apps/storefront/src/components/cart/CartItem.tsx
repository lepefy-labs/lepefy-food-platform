import { LepefyImage } from '@/components/images/LepefyImage';
import Link from 'next/link';
import { IconPhoto } from '@tabler/icons-react';
import type { CartItem as CartItemType, ProductFulfillmentPolicy } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';
import { deriveCartItemState } from '@/lib/cart/cartItemState';
import { CartStepper } from './CartStepper';
import { decrementRemovesLine, getMaximumValidQuantity, stepPurchaseQuantity } from '@/lib/purchaseQuantityRules';
import { describePrice, formatCount, orderLineDetail, resolveSellingFormat } from '@/lib/storefrontCopy/sellingFormat';
import { cartLineIssue } from '@/lib/storefrontCopy/availability';
import { FulfillmentPolicyChip } from '@/components/catalog/FulfillmentPolicyChip';
import { formatLabelOf, formatQuantityLabel } from '@/lib/catalog/saleFormats';
import { formatSwapTitle } from '@/lib/storefrontCopy/saleFormatCopy';
import type { CartFormatSwap } from '@/lib/cart/useCartFormatSwaps';

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
  /** « Passer au lot et économiser X € » (formats de vente, migration 187). */
  formatSwap?: CartFormatSwap;
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
  formatSwap,
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
  // Formats de vente (187) : « 1 lot de 3 paquets » / « 2 paquets », jamais ambigu.
  const formatLabel = formatLabelOf(product);
  const countLabel = (count: number) => formatLabel ? formatQuantityLabel(formatLabel, count) : formatCount(sellingFormat, count);
  const displayName = formatLabel && product.name.endsWith(` — ${formatLabel}`)
    ? product.name.slice(0, -(` — ${formatLabel}`).length)
    : product.name;
  const lineDetail = formatLabel && !product.sale_unit && !product.net_quantity_display
    ? `${countLabel(quantity)} · ${formatPrice(product.price, currency)} ${quantity > 1 ? 'chacun' : ''}`.trim()
    : orderLineDetail(product.price, quantity, sellingFormat, currency);
  const issue = cartLineIssue({
    removed: state === 'unavailable',
    stock: product.stock,
    quantity,
    minimum: product.min_order_quantity ?? 1,
    step: product.order_quantity_step ?? 1,
    countLabel,
  });
  const minimum = product.min_order_quantity ?? 1;
  const step = product.order_quantity_step ?? 1;
  const canIncrement = stepPurchaseQuantity(quantity, minimum, step, product.stock, 'increment') !== null;
  const removesOnDecrement = decrementRemovesLine(quantity, minimum, step);
  const lineTotal = product.price * quantity;

  const issueNotice = issue && (
    <p className={`mt-1.5 flex flex-wrap items-center gap-x-2 rounded-lg px-2 py-1 text-xs font-semibold leading-snug ${issue.kind === 'over_stock' || issue.kind === 'off_rule' ? 'bg-amber-50 text-amber-900' : 'bg-red-50 text-red-800'}`} role="status">
      <span>{issue.message}</span>
      {(issue.kind === 'over_stock' || issue.kind === 'off_rule') && onAdjust && (
        <button
          type="button"
          onClick={() => onAdjust(product.id, issue.target)}
          className="relative z-20 inline-flex min-h-9 items-center font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          Passer à {countLabel(issue.target)}
        </button>
      )}
    </p>
  );
  const stepper = (
    <div className="flex items-center gap-1.5">
      <CartStepper
        quantity={quantity}
        productName={formatLabel ? `${displayName}, ${formatLabel}` : product.name}
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
  );

  if (variant === 'page') {
    // Card autonome du panier : zone produit (image et nom → fiche, détail
    // « 4 sachets de 500 g · 4,00 € le sachet », disponibilité, mode de
    // réception) puis zone d'actions séparée (+/− et total de ligne). Une
    // seule action de retrait : le «−» devient corbeille au minimum, et une
    // ligne bloquée (retirée du catalogue, plus de stock) ne propose que lui.
    const href = `/products/${product.slug}`;
    const removeOnly = blocked;
    return (
      <li className="rounded-2xl border border-gray-200 bg-white p-3 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-4">
        <div className="flex gap-3 sm:gap-4">
          <Link href={href} tabIndex={-1} aria-hidden="true"
            className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-gray-50 ring-1 ring-black/5 sm:h-20 sm:w-20">
            {product.image_url ? (
              <LepefyImage
                src={product.image_url}
                variant="thumbnail"
                alt=""
                fill
                sizes="(min-width: 640px) 80px, 72px"
                className={`object-cover ${blocked ? 'opacity-50 grayscale' : ''}`}
              />
            ) : (
              <IconPhoto size={26} stroke={1.5} aria-hidden="true" className="absolute inset-0 m-auto text-gray-300" />
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={href}
              className="block break-words text-[15px] font-bold leading-snug text-gray-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:text-base">
              {displayName}
            </Link>
            {formatLabel && (
              <span className="mt-1 inline-block rounded-md px-1.5 py-0.5 text-xs font-bold text-gray-900" style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, white)' }}>
                {countLabel(quantity)}
              </span>
            )}
            <p className="mt-0.5 text-sm leading-snug text-gray-700">{lineDetail}</p>
            {fulfillmentPolicy && fulfillmentPolicy !== 'delivery_or_pickup' && (
              <FulfillmentPolicyChip policy={fulfillmentPolicy} className="mt-1.5" />
            )}
            {issueNotice}
          </div>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-gray-100 pt-2.5">
          <div className="flex items-center gap-1.5">
            <CartStepper
              variant="cart"
              quantity={quantity}
              productName={formatLabel ? `${displayName}, ${formatLabel}` : product.name}
              removesOnDecrement={removeOnly || removesOnDecrement}
              canIncrement={!blocked && canIncrement && quantity < maxPurchasable}
              onIncrement={() => onIncrement(product.id)}
              onDecrement={() => (removeOnly ? onRemove(product.id) : onDecrement(product.id))}
            />
            {state === 'pending' && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-300 motion-reduce:animate-none" aria-hidden="true" />
            )}
          </div>
          <p className="text-right leading-tight">
            <span className="block text-xs font-medium text-gray-600">Total</span>
            <span className="text-lg font-extrabold tabular-nums text-gray-950">{formatPrice(lineTotal, currency)}</span>
          </p>
        </div>
        {formatSwap && !blocked && (
          <div role="region" aria-label="Proposition de format" className="mt-2.5 rounded-xl border border-green-300 bg-green-50 px-3 py-2.5 text-green-950">
            <p className="text-sm font-bold">{formatSwapTitle(formatSwap.proposal.savings, currency)}</p>
            <p className="mt-0.5 text-xs leading-snug">
              {countLabel(quantity)} → {formatQuantityLabel(formatSwap.proposal.label, formatSwap.proposal.formatQuantity)}
              {formatSwap.proposal.baseQuantity > 0 ? ` + ${countLabel(formatSwap.proposal.baseQuantity)}` : ''}. Même quantité de produit.
            </p>
            <button
              type="button"
              onClick={() => formatSwap.apply()}
              className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-green-700 px-3 text-sm font-bold text-white hover:bg-green-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Passer au lot · −{formatPrice(formatSwap.proposal.savings, currency)}
            </button>
          </div>
        )}
      </li>
    );
  }

  return (
    <li className="flex gap-4 border-b border-gray-100 py-4 last:border-0">
      <div className="pointer-events-none relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-2xl bg-gray-50 shadow-sm ring-1 ring-black/5">
        {product.image_url ? (
          <LepefyImage
            src={product.image_url}
            variant="thumbnail"
            alt={product.name}
            fill
            sizes="64px"
            className="object-cover"
          />
        ) : (
          <IconPhoto size={26} stroke={1.5} aria-hidden="true" className="absolute inset-0 m-auto text-gray-300" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-bold leading-snug text-gray-950">{displayName}</p>
        {formatLabel ? (
          <p className="mt-1 text-xs text-gray-800"><span className="font-bold">{countLabel(quantity)}</span> · {formatPrice(product.price, currency)}</p>
        ) : (
          <p className="mt-1 text-xs text-gray-700">
            <span className="font-semibold">{price.amount}</span> {price.unitPhrase}
          </p>
        )}
        {fulfillmentPolicy && fulfillmentPolicy !== 'delivery_or_pickup' && (
          <FulfillmentPolicyChip policy={fulfillmentPolicy} className="mt-1.5" />
        )}
        {issueNotice}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {stepper}
          <span className="rounded-lg bg-white/80 px-2 py-1 text-sm font-bold tabular-nums ring-1 ring-black/5" aria-live="polite">
            {formatPrice(lineTotal, currency)}
          </span>
        </div>

        <button
          type="button"
          onClick={() => onRemove(product.id)}
          className="-ml-2 mt-0.5 inline-flex min-h-9 items-center rounded px-2 text-xs font-medium text-gray-500 transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          Retirer
        </button>
      </div>
    </li>
  );
}
