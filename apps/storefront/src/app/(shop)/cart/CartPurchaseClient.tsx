'use client';

import { useRouter } from 'next/navigation';
import { getShoppingReturn } from '@/lib/catalog/shoppingReturn';
import { IconArrowLeft, IconArrowRight, IconLock } from '@tabler/icons-react';
import { CartEmpty } from '@/components/cart/CartEmpty';
import { CartItem } from '@/components/cart/CartItem';
import { CartUndoToast } from '@/components/cart/CartUndoToast';
import { QuantityGroupProgress } from '@/components/cart/QuantityGroupProgress';
import { CartFulfillmentNotice } from '@/components/cart/CartFulfillmentNotice';
import { cartProductPolicy } from '@/lib/fulfillment/fulfillmentPolicy';
import { selectCartIsEmpty, selectCartItemCount, selectCartItems, selectCartSubtotal, selectPendingProductIds } from '@/lib/cart/cartSelectors';
import { formatProductCount } from '@/lib/cart/formatProductCount';
import { formatPrice } from '@/lib/utils/format';
import { useCartStore } from '@/stores/cartStore';
import { useCartPurchaseGate } from '@/lib/cart/useCartPurchaseGate';
import { ACTION_COPY, SUMMARY_COPY, productsPriceLabel } from '@/lib/storefrontCopy/copy';
import type { CartItem as CartItemType, PublicTenant } from '@lepefy/types';
import { useEffect, useState } from 'react';

const UNDO_TIMEOUT_MS = 5000;

export default function CartPurchaseClient({ tenant }: { tenant: PublicTenant }) {
  const router = useRouter();
  const items = useCartStore(selectCartItems);
  const itemCount = useCartStore(selectCartItemCount);
  const subtotal = useCartStore(selectCartSubtotal);
  const isEmpty = useCartStore(selectCartIsEmpty);
  const pendingProductIds = useCartStore(selectPendingProductIds);
  const unavailableProductIds = useCartStore((state) => state.unavailableProductIds);
  const incrementItem = useCartStore((state) => state.incrementItem);
  const decrementItem = useCartStore((state) => state.decrementItem);
  const removeItem = useCartStore((state) => state.removeItem);
  const addItem = useCartStore((state) => state.addItem);
  const [undo, setUndo] = useState<{ item: CartItemType; timeoutId: ReturnType<typeof setTimeout> } | null>(null);
  const {
    groups: quantityGroups, error: groupsError, reloadGroups, blockedMessage, canProceed, checking, fulfillment,
  } = useCartPurchaseGate(items);

  useEffect(() => () => { if (undo) clearTimeout(undo.timeoutId); }, [undo]);

  if (isEmpty) return <div className="flex min-h-[60vh]"><CartEmpty headingLevel="h1" /></div>;

  function increment(productId: string) {
    incrementItem(productId);
  }

  function decrement(productId: string) {
    decrementItem(productId);
  }

  function remove(productId: string) {
    const item = items.find((entry) => entry.product.id === productId);
    if (!item) return;
    if (undo) clearTimeout(undo.timeoutId);
    removeItem(productId);
    setUndo({ item, timeoutId: setTimeout(() => setUndo(null), UNDO_TIMEOUT_MS) });
  }

  function restore() {
    if (!undo) return;
    clearTimeout(undo.timeoutId);
    addItem(undo.item.product, undo.item.quantity);
    setUndo(null);
  }

  function continueShopping() {
    router.push(getShoppingReturn('/'));
  }

  function startCheckout() {
    if (!canProceed) return;
    sessionStorage.removeItem('lepefy-checkout-shipping');
    router.push('/checkout');
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 pb-44 sm:px-6 sm:py-7 md:pb-10 lg:px-8">
      <button type="button" onClick={continueShopping} className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-800 hover:bg-gray-50">
        <IconArrowLeft size={17} /> Continuer mes achats
      </button>
      <h1 className="mb-4 font-display text-2xl font-bold text-gray-950">Mon panier</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4 lg:order-1">
          <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-[0_8px_26px_rgba(15,23,42,0.05)] sm:p-5 lg:hidden" aria-label="Total du panier">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-gray-700">{SUMMARY_COPY.productsPrice}</p>
                <p className="mt-0.5 text-3xl font-black tracking-tight text-gray-950">{formatPrice(subtotal, tenant.currency)}</p>
              </div>
              <p className="pb-1 text-sm font-medium text-gray-600">{formatProductCount(itemCount)}</p>
            </div>
            <p className="mt-2 text-sm text-gray-700">Livraison : {SUMMARY_COPY.shippingNextStep}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-green-700"><IconLock size={13} aria-hidden="true" /> Paiement sécurisé</p>
          </section>

          {groupsError && (
            <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {groupsError}
              <button type="button" onClick={reloadGroups} className="ml-2 min-h-11 font-bold underline">{ACTION_COPY.retry}</button>
            </div>
          )}
          <QuantityGroupProgress groups={quantityGroups} items={items} />
          {!checking && <CartFulfillmentNotice eligibility={fulfillment} pickupAvailable={Boolean(tenant.click_collect_enabled)} />}

          <section aria-label="Articles du panier">
            <ul className="space-y-3">
              {items.map((item) => (
                <CartItem
                  key={item.product.id}
                  item={item}
                  variant="page"
                  currency={tenant.currency}
                  unavailableProductIds={unavailableProductIds}
                  pendingProductIds={pendingProductIds}
                  fulfillmentPolicy={checking ? undefined : cartProductPolicy(fulfillment, item.product.id)}
                  onIncrement={increment}
                  onDecrement={decrement}
                  onRemove={remove}
                />
              ))}
            </ul>
            {undo && <div className="pt-3"><CartUndoToast productName={undo.item.product.name} onUndo={restore} /></div>}
          </section>

          <div className="hidden flex-col gap-2 md:flex lg:hidden">
            {blockedMessage && <p className="text-sm font-semibold text-amber-900" role="status">{blockedMessage}</p>}
            <div className="flex items-center gap-3">
              <button type="button" onClick={continueShopping} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm font-bold text-gray-800 hover:bg-gray-50">
                <IconArrowLeft size={16} aria-hidden="true" /> {ACTION_COPY.continueShopping}
              </button>
              <button
                type="button"
                onClick={startCheckout}
                disabled={!canProceed}
                aria-disabled={!canProceed}
                className="flex min-h-12 flex-[1.2] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {ACTION_COPY.goToShipping} <IconArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <aside className="hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-[0_10px_35px_rgba(15,23,42,0.05)] lg:sticky lg:top-24 lg:block">
          <dl className="text-sm">
            <div className="flex items-baseline justify-between gap-3 py-1">
              <dt className="text-gray-700">{productsPriceLabel(itemCount)}</dt>
              <dd className="text-2xl font-black tracking-tight tabular-nums text-gray-950">{formatPrice(subtotal, tenant.currency)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-1">
              <dt className="text-gray-700">Livraison</dt>
              <dd className="text-gray-800">{SUMMARY_COPY.shippingNextStep}</dd>
            </div>
          </dl>
          {blockedMessage && <p className="mt-3 text-sm font-semibold text-amber-900" role="status">{blockedMessage}</p>}
          <button
            type="button"
            onClick={startCheckout}
            disabled={!canProceed}
            aria-disabled={!canProceed}
            className="mt-3 min-h-12 w-full rounded-2xl px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {ACTION_COPY.goToShipping}
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-green-700"><IconLock size={13} aria-hidden="true" /> Paiement sécurisé</p>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-16 z-40 border-t border-black/10 bg-white/95 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_30px_rgba(0,0,0,.08)] backdrop-blur md:hidden">
        <div className="mx-auto max-w-xl">
          {blockedMessage && <p className="mb-1.5 text-center text-sm font-semibold leading-snug text-amber-900" role="status">{blockedMessage}</p>}
          <div className="grid grid-cols-[0.9fr_1.25fr] gap-2.5">
            <button type="button" onClick={continueShopping} className="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl border border-gray-300 bg-white px-2 py-3 text-xs font-bold text-gray-800">
              <IconArrowLeft size={15} aria-hidden="true" /> {ACTION_COPY.continueShopping}
            </button>
            <button
              type="button"
              onClick={startCheckout}
              disabled={!canProceed}
              aria-disabled={!canProceed}
              className="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl px-3 py-3 text-sm font-bold text-white transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {ACTION_COPY.goToShipping} <IconArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
