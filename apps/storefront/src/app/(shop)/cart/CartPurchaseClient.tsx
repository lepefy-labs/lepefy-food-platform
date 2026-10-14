'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getShoppingReturn, markShoppingReturn } from '@/lib/catalog/shoppingReturn';
import { IconArrowLeft, IconArrowRight, IconLoader2, IconLock } from '@tabler/icons-react';
import { CartEmpty } from '@/components/cart/CartEmpty';
import { CartItem } from '@/components/cart/CartItem';
import { CartUndoToast } from '@/components/cart/CartUndoToast';
import { CartReturnBar } from '@/components/cart/CartReturnBar';
import { CartCheckoutBar } from '@/components/cart/CartCheckoutBar';
import { CartPromoReminder } from '@/components/cart/CartPromoReminder';
import { QuantityGroupProgress } from '@/components/cart/QuantityGroupProgress';
import { CartFulfillmentNotice } from '@/components/cart/CartFulfillmentNotice';
import { cartProductPolicy } from '@/lib/fulfillment/fulfillmentPolicy';
import { selectCartIsEmpty, selectCartItemCount, selectCartItems, selectCartSubtotal, selectPendingProductIds } from '@/lib/cart/cartSelectors';
import { formatProductCount } from '@/lib/cart/formatProductCount';
import { formatPrice } from '@/lib/utils/format';
import { decrementRemovesLine } from '@/lib/purchaseQuantityRules';
import { useCartStore } from '@/stores/cartStore';
import { useCartPurchaseGate } from '@/lib/cart/useCartPurchaseGate';
import { ACTION_COPY, SUMMARY_COPY, productsPriceLabel } from '@/lib/storefrontCopy/copy';
import type { CartItem as CartItemType, PublicTenant } from '@lepefy/types';
import { useEffect, useRef, useState } from 'react';

const UNDO_TIMEOUT_MS = 5000;
// Si la navigation vers /checkout n'aboutit pas (réseau), le bouton redevient actif.
const LEAVING_RESET_MS = 8000;

export default function CartPurchaseClient({ tenant, promoCount = 0 }: { tenant: PublicTenant; promoCount?: number }) {
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
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const addItem = useCartStore((state) => state.addItem);
  const [undo, setUndo] = useState<{ item: CartItemType; timeoutId: ReturnType<typeof setTimeout> } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const leavingTimer = useRef<ReturnType<typeof setTimeout>>();
  const [returnHref, setReturnHref] = useState('/');
  const {
    groups: quantityGroups, error: groupsError, reloadGroups, blockedMessage, canProceed, checking, fulfillment,
  } = useCartPurchaseGate(items);

  useEffect(() => () => { if (undo) clearTimeout(undo.timeoutId); }, [undo]);
  useEffect(() => () => clearTimeout(leavingTimer.current), []);
  useEffect(() => { setReturnHref(getShoppingReturn('/')); }, []);

  if (isEmpty) return <div className="flex min-h-[60vh]"><CartEmpty headingLevel="h1" /></div>;

  function increment(productId: string) {
    incrementItem(productId);
  }

  function decrement(productId: string) {
    const item = items.find((entry) => entry.product.id === productId);
    if (!item) return;
    // Au minimum, «−» retire la ligne : même chemin que « Retirer », avec annulation.
    if (decrementRemovesLine(item.quantity, item.product.min_order_quantity ?? 1, item.product.order_quantity_step ?? 1)) remove(productId);
    else decrementItem(productId);
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

  // Le panier mène toujours à l'entrée de /checkout, qui refait toutes les
  // validations (quantités, stock, mode de réception, adresse, paiement).
  function startCheckout() {
    if (leavingRef.current || !canProceed) return;
    leavingRef.current = true;
    setLeaving(true);
    try { sessionStorage.removeItem('lepefy-checkout-shipping'); } catch { /* storage disabled */ }
    router.push('/checkout');
    leavingTimer.current = setTimeout(() => { leavingRef.current = false; setLeaving(false); }, LEAVING_RESET_MS);
  }

  const busy = checking || leaving;
  const ctaDisabled = busy || !canProceed;
  const ctaContent = busy
    ? <><IconLoader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {checking ? 'Vérification du panier…' : ACTION_COPY.processing}</>
    : <>{ACTION_COPY.goToShipping} <IconArrowRight size={16} aria-hidden="true" /></>;
  const staticMessage = checking ? null : blockedMessage;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-6 sm:px-6 md:pb-10 lg:px-8">
      <CartReturnBar itemCount={itemCount} />
      <h1 className="mb-4 font-display text-2xl font-bold text-gray-950">Mon panier</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4 lg:order-1">
          {/* Tablette : récapitulatif en tête (mobile : barre du bas ; desktop : colonne). */}
          <section className="hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-[0_8px_26px_rgba(15,23,42,0.05)] md:block lg:hidden" aria-label="Total du panier">
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
                  onAdjust={updateQuantity}
                />
              ))}
            </ul>
            {undo && <div className="pt-3"><CartUndoToast productName={undo.item.product.name} onUndo={restore} /></div>}
          </section>

          <CartPromoReminder count={promoCount} />

          <div className="hidden flex-col gap-2 md:flex lg:hidden">
            {staticMessage && <p className="text-sm font-semibold text-amber-900" role="status">{staticMessage}</p>}
            <div className="flex items-center gap-3">
              <Link href={returnHref} scroll={false} onClick={markShoppingReturn} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm font-bold text-gray-800 hover:bg-gray-50">
                <IconArrowLeft size={16} aria-hidden="true" /> {ACTION_COPY.continueShopping}
              </Link>
              <button
                type="button"
                onClick={startCheckout}
                disabled={ctaDisabled}
                aria-disabled={ctaDisabled}
                aria-busy={busy || undefined}
                className="flex min-h-12 flex-[1.2] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {ctaContent}
              </button>
            </div>
          </div>
        </div>

        <aside className="hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-[0_10px_35px_rgba(15,23,42,0.05)] lg:sticky lg:top-40 lg:block">
          <dl className="text-sm">
            <div className="flex items-baseline justify-between gap-3 py-1">
              <dt className="text-gray-700">{productsPriceLabel(itemCount)}</dt>
              <dd className="text-2xl font-black tracking-tight tabular-nums text-gray-950" aria-live="polite">{formatPrice(subtotal, tenant.currency)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-1">
              <dt className="text-gray-700">Livraison</dt>
              <dd className="text-gray-800">{SUMMARY_COPY.shippingNextStep}</dd>
            </div>
          </dl>
          {staticMessage && <p className="mt-3 text-sm font-semibold text-amber-900" role="status">{staticMessage}</p>}
          <button
            type="button"
            onClick={startCheckout}
            disabled={ctaDisabled}
            aria-disabled={ctaDisabled}
            aria-busy={busy || undefined}
            className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {ctaContent}
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-green-700"><IconLock size={13} aria-hidden="true" /> Paiement sécurisé</p>
        </aside>
      </div>

      <CartCheckoutBar
        subtotal={subtotal}
        currency={tenant.currency}
        itemCount={itemCount}
        blockedMessage={blockedMessage}
        checking={checking}
        leaving={leaving}
        onCheckout={startCheckout}
      />
    </div>
  );
}
