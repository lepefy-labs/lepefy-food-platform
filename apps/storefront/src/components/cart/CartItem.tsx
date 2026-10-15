import { LepefyImage } from '@/components/images/LepefyImage';
import Link from 'next/link';
import { IconPhoto, IconX } from '@tabler/icons-react';
import type { CartItem as CartItemType, ProductFulfillmentPolicy } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';
import { deriveCartItemState } from '@/lib/cart/cartItemState';
import { CartStepper } from './CartStepper';
import { decrementRemovesLine, getMaximumValidQuantity, stepPurchaseQuantity } from '@/lib/purchaseQuantityRules';
import { describePrice, formatCount, orderLineDetail, resolveSellingFormat } from '@/lib/storefrontCopy/sellingFormat';
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

  const issueNotice = issue && (
    <p className={`mt-1.5 flex flex-wrap items-center gap-x-2 rounded-lg px-2 py-1 text-xs font-semibold leading-snug ${issue.kind === 'over_stock' || issue.kind === 'off_rule' ? 'bg-amber-50 text-amber-900' : 'bg-red-50 text-red-800'}`} role="status">
      <span>{issue.message}</span>
      {(issue.kind === 'over_stock' || issue.kind === 'off_rule') && onAdjust && (
        <button
          type="button"
          onClick={() => onAdjust(product.id, issue.target)}
          className="relative z-20 inline-flex min-h-9 items-center font-bold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          Passer à {formatCount(sellingFormat, issue.target)}
        </button>
      )}
    </p>
  );
  const stepper = (
    <div className="flex items-center gap-1.5">
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
  );

  if (variant === 'page') {
    // Ligne compacte du panier : image et nom mènent à la fiche, détail
    // « 3 sachets de 150 g · 1,00 € le sachet », +/− et total de ligne sur la
    // même rangée, retrait explicite (✕) distinct du «−».
    const href = `/products/${product.slug}`;
    return (
      <li className="flex gap-3 px-3 py-3 max-[359px]:gap-2.5 max-[359px]:px-2.5 sm:gap-4 sm:px-4">
        <Link href={href} tabIndex={-1} aria-hidden="true"
          className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-gray-50 ring-1 ring-black/5 max-[359px]:h-16 max-[359px]:w-16 sm:h-20 sm:w-20">
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
          <div className="flex items-start gap-1">
            <Link href={href}
              className="line-clamp-2 min-w-0 flex-1 text-[15px] font-bold leading-snug text-gray-950 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] sm:text-base">
              {product.name}
            </Link>
            <button
              type="button"
              onClick={() => onRemove(product.id)}
              aria-label={`Retirer ${product.name} du panier`}
              title="Retirer du panier"
              className="-mr-2 -mt-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 motion-reduce:transition-none"
            >
              <IconX size={18} aria-hidden="true" />
            </button>
          </div>
          <p className="text-sm leading-snug text-gray-700">{orderLineDetail(product.price, quantity, sellingFormat, currency)}</p>
          {fulfillmentPolicy && fulfillmentPolicy !== 'delivery_or_pickup' && (
            <FulfillmentPolicyChip policy={fulfillmentPolicy} className="mt-1" />
          )}
          {issueNotice}
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            {stepper}
            <p className="ml-auto text-base font-extrabold tabular-nums text-gray-950">
              <span className="sr-only">Total de la ligne : </span>{formatPrice(lineTotal, currency)}
            </p>
          </div>
        </div>
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
        <p className="line-clamp-2 text-sm font-bold leading-snug text-gray-950">{product.name}</p>
        <p className="mt-1 text-xs text-gray-700">
          <span className="font-semibold">{price.amount}</span> {price.unitPhrase}
        </p>
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
