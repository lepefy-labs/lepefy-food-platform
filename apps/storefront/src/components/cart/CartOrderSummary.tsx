import Link from 'next/link';
import { formatPrice } from '@/lib/utils/format';
import { FreeShippingProgress } from './FreeShippingProgress';
import type { CartSyncStatus } from '@/lib/cart/cartTypes';

interface CartOrderSummaryProps {
  subtotal: number;
  shippingCost: number | null;
  shippingLabel?: string;
  total: number;
  currency?: string;
  canProceed: boolean;
  checkoutHint?: string | null;
  syncStatus: CartSyncStatus;
  freeShippingThreshold?: number | null;
  onCheckout: () => void;
  children?: React.ReactNode;
}

function SyncMessage({ status }: { status: CartSyncStatus }) {
  if (status === 'offline') return <p role="status">Modifications enregistrées sur cet appareil.</p>;
  if (status === 'error') {
    return <p role="status">Impossible de synchroniser votre panier. Nous réessaierons automatiquement.</p>;
  }
  return null;
}

export function CartOrderSummary({
  subtotal,
  shippingCost,
  shippingLabel = 'Livraison',
  total,
  currency,
  canProceed,
  checkoutHint,
  syncStatus,
  freeShippingThreshold = null,
  onCheckout,
  children,
}: CartOrderSummaryProps) {
  return (
    <section aria-labelledby="cart-summary-title" className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm sm:p-6">
      <h2 id="cart-summary-title" className="text-lg font-bold">Résumé de la commande</h2>

      {children && <div className="mt-5">{children}</div>}

      <dl className="mt-6 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-gray-500">Sous-total</dt>
          <dd className="font-semibold tabular-nums">{formatPrice(subtotal, currency)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-gray-500">{shippingLabel}</dt>
          <dd className="font-semibold tabular-nums">
            {shippingCost === null ? <span className="text-gray-400">À calculer</span> : shippingCost === 0 ? <span className="text-green-700">Gratuit</span> : formatPrice(shippingCost, currency)}
          </dd>
        </div>
        <div className="flex items-end justify-between gap-4 border-t border-gray-200 pt-4">
          <dt className="text-base font-bold">Total</dt>
          <dd className="text-2xl font-bold tabular-nums" aria-live="polite">{formatPrice(total, currency)}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <FreeShippingProgress subtotal={subtotal} threshold={freeShippingThreshold} currency={currency} />
      </div>

      <button
        type="button"
        onClick={onCheckout}
        disabled={!canProceed}
        className="mt-6 w-full rounded-2xl py-4 text-base font-bold text-white transition-opacity active:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)]"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        Continuer vers le paiement
      </button>
      {checkoutHint && <p className="mt-2 text-center text-xs text-gray-500">{checkoutHint}</p>}

      <Link href="/products" className="mt-4 block text-center text-sm font-semibold text-gray-600 hover:text-gray-900 focus-visible:outline-none focus-visible:underline">
        Continuer mes achats
      </Link>

      <div className="mt-3 min-h-4 text-center text-xs text-amber-700" aria-live="polite">
        <SyncMessage status={syncStatus} />
      </div>
    </section>
  );
}
