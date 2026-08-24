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
  primaryActionLabel?: string;
  primaryActionDisabled?: boolean;
  syncStatus: CartSyncStatus;
  freeShippingThreshold?: number | null;
  onCheckout: () => void;
  children?: React.ReactNode;
  hideActionsOnMobile?: boolean;
}

function SyncMessage({ status }: { status: CartSyncStatus }) {
  if (status === 'offline') return <p role="status">Modifications enregistrées sur cet appareil.</p>;
  if (status === 'error') return <p role="status">Impossible de synchroniser votre panier. Nous réessaierons automatiquement.</p>;
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
  primaryActionLabel = 'Continuer vers le paiement',
  primaryActionDisabled = false,
  syncStatus,
  freeShippingThreshold = null,
  onCheckout,
  children,
  hideActionsOnMobile = false,
}: CartOrderSummaryProps) {
  const totalIsEstimated = shippingCost === null;

  return (
    <section aria-labelledby="cart-summary-title" className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-[0_10px_35px_rgba(15,23,42,0.05)]">
      <div className="border-b border-gray-100 px-5 py-4 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-400">Finaliser votre panier</p>
        <h2 id="cart-summary-title" className="mt-1 text-xl font-bold tracking-tight text-gray-950">Résumé de la commande</h2>
      </div>

      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        {children && <div className="py-5">{children}</div>}

        <dl className="border-t border-gray-100 pt-5 text-sm">
          <div className="flex items-center justify-between gap-4 py-1.5">
            <dt className="text-gray-500">Sous-total</dt>
            <dd className="font-semibold tabular-nums text-gray-900">{formatPrice(subtotal, currency)}</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-1.5">
            <dt className="text-gray-500">{shippingLabel}</dt>
            <dd className="font-semibold tabular-nums">
              {shippingCost === null ? <span className="text-amber-700">Adresse requise</span> : shippingCost === 0 ? <span className="text-green-700">Gratuit</span> : formatPrice(shippingCost, currency)}
            </dd>
          </div>
          <div className="mt-3 flex items-end justify-between gap-4 border-t border-gray-200 pt-4">
            <div>
              <dt className="text-base font-bold text-gray-950">{totalIsEstimated ? 'Total estimé' : 'Total'}</dt>
              {totalIsEstimated && <p className="mt-0.5 text-[11px] text-gray-400">hors frais de livraison</p>}
            </div>
            <dd className="text-2xl font-bold tabular-nums text-gray-950" aria-live="polite">{formatPrice(total, currency)}</dd>
          </div>
        </dl>

        <div className="mt-4">
          <FreeShippingProgress subtotal={subtotal} threshold={freeShippingThreshold} currency={currency} />
        </div>

        <div className={hideActionsOnMobile ? 'hidden md:block' : undefined}>
          {checkoutHint && (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-left" role="status">
              <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-amber-700">Pour continuer</p>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-amber-950">{checkoutHint}</p>
            </div>
          )}
          <button
            type="button"
            onClick={onCheckout}
            disabled={primaryActionDisabled}
            className="mt-4 min-h-12 w-full rounded-2xl px-4 py-3.5 text-base font-bold text-white transition-[opacity,transform] active:scale-[0.99] disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)] motion-reduce:transition-none"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {primaryActionLabel}
          </button>
          {!canProceed && !primaryActionDisabled && (
            <p className="mt-2 text-center text-[11px] leading-relaxed text-gray-400">Le paiement reste inaccessible tant que la livraison n’est pas calculée.</p>
          )}

          <Link href="/products" className="mt-3 flex min-h-10 items-center justify-center text-sm font-semibold text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:underline">
            Continuer mes achats
          </Link>
        </div>

        <div className="mt-2 min-h-4 text-center text-xs text-amber-700" aria-live="polite">
          <SyncMessage status={syncStatus} />
        </div>
      </div>
    </section>
  );
}
