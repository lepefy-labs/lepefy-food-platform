'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconArrowLeft, IconArrowRight, IconLock } from '@tabler/icons-react';
import { CartEmpty } from '@/components/cart/CartEmpty';
import { CartItem } from '@/components/cart/CartItem';
import { CartUndoToast } from '@/components/cart/CartUndoToast';
import { selectCartIsEmpty, selectCartItemCount, selectCartItems, selectCartSubtotal, selectPendingProductIds } from '@/lib/cart/cartSelectors';
import { formatProductCount } from '@/lib/cart/formatProductCount';
import { formatPrice } from '@/lib/utils/format';
import { useCartStore } from '@/stores/cartStore';
import type { CartItem as CartItemType, Tenant } from '@lepefy/types';
import { useEffect, useState } from 'react';

const UNDO_TIMEOUT_MS = 5000;

export default function CartPurchaseClient({ tenant }: { tenant: Tenant }) {
  const router = useRouter();
  const items = useCartStore(selectCartItems);
  const itemCount = useCartStore(selectCartItemCount);
  const subtotal = useCartStore(selectCartSubtotal);
  const isEmpty = useCartStore(selectCartIsEmpty);
  const pendingProductIds = useCartStore(selectPendingProductIds);
  const unavailableProductIds = useCartStore((state) => state.unavailableProductIds);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const addItem = useCartStore((state) => state.addItem);
  const [undo, setUndo] = useState<{ item: CartItemType; timeoutId: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => () => { if (undo) clearTimeout(undo.timeoutId); }, [undo]);

  if (isEmpty) return <div className="flex min-h-[60vh]"><CartEmpty headingLevel="h1" /></div>;

  function increment(productId: string) {
    const item = items.find((entry) => entry.product.id === productId);
    if (item) updateQuantity(productId, Math.min(item.quantity + 1, item.product.stock));
  }

  function decrement(productId: string) {
    const item = items.find((entry) => entry.product.id === productId);
    if (item) updateQuantity(productId, item.quantity - 1);
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

  function startCheckout() {
    sessionStorage.removeItem('lepefy-checkout-shipping');
    router.push('/checkout');
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 pb-44 sm:px-6 sm:py-7 md:pb-10 lg:px-8">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4 lg:order-1">
          <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-[0_8px_26px_rgba(15,23,42,0.05)] sm:p-5 lg:hidden" aria-label="Total du panier">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-gray-700">Total estimé</p>
                <p className="mt-0.5 text-3xl font-black tracking-tight text-gray-950">{formatPrice(subtotal, tenant.currency)}</p>
              </div>
              <p className="pb-1 text-sm font-medium text-gray-500">{formatProductCount(itemCount)}</p>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-green-700"><IconLock size={13} /> Paiement 100 % sécurisé</p>
          </section>

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
                  onIncrement={increment}
                  onDecrement={decrement}
                  onRemove={remove}
                />
              ))}
            </ul>
            {undo && <div className="pt-3"><CartUndoToast productName={undo.item.product.name} onUndo={restore} /></div>}
          </section>

          <div className="hidden items-center gap-3 md:flex lg:max-w-xl">
            <Link href="/products" className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm font-bold text-gray-800 hover:bg-gray-50">
              <IconArrowLeft size={16} /> Continuer mes achats
            </Link>
            <button type="button" onClick={startCheckout} className="flex min-h-12 flex-[1.2] items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
              Continuer — Livraison <IconArrowRight size={16} />
            </button>
          </div>
        </div>

        <aside className="hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-[0_10px_35px_rgba(15,23,42,0.05)] lg:sticky lg:top-24 lg:block">
          <p className="text-sm font-semibold text-gray-700">Total estimé</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="text-3xl font-black tracking-tight text-gray-950">{formatPrice(subtotal, tenant.currency)}</p>
            <p className="pb-1 text-xs font-medium text-gray-500">{formatProductCount(itemCount)}</p>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-gray-500">Les frais de livraison seront calculés à l’étape suivante selon votre adresse.</p>
          <button type="button" onClick={startCheckout} className="mt-5 min-h-12 w-full rounded-2xl px-4 py-3 font-bold text-white" style={{ backgroundColor: 'var(--color-primary)' }}>
            Continuer — Livraison
          </button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-green-700"><IconLock size={13} /> Paiement sécurisé</p>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-16 z-40 border-t border-black/10 bg-white/95 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-10px_30px_rgba(0,0,0,.08)] backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-xl grid-cols-[0.9fr_1.25fr] gap-2.5">
          <Link href="/products" className="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl border border-gray-300 bg-white px-3 py-3 text-sm font-bold text-gray-800">
            <IconArrowLeft size={15} /> Achats
          </Link>
          <button
            type="button"
            onClick={startCheckout}
            className="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl px-3 py-3 text-sm font-bold text-white transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)] motion-reduce:transition-none"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            Livraison <IconArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
