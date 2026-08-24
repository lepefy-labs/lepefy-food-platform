import { formatPrice } from '@/lib/utils/format';

interface MobileCartStickyCTAProps {
  total: number;
  currency?: string;
  totalIsEstimated?: boolean;
  label?: string;
  hint?: string | null;
  disabled?: boolean;
  onCheckout: () => void;
}

export function MobileCartStickyCTA({
  total,
  currency,
  totalIsEstimated = false,
  label = 'Continuer vers le paiement',
  hint = null,
  disabled = false,
  onCheckout,
}: MobileCartStickyCTAProps) {
  return (
    <div
      className="fixed inset-x-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur motion-reduce:backdrop-blur-none md:hidden"
      style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto max-w-md">
        {hint && (
          <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-semibold leading-relaxed text-amber-900" role="status">
            {hint}
          </p>
        )}
        <div className="mb-2 flex items-end justify-between gap-4">
          <div>
            <span className="text-sm font-semibold text-gray-700">{totalIsEstimated ? 'Total estimé' : 'Total'}</span>
            {totalIsEstimated && <p className="text-[10px] text-gray-400">hors livraison</p>}
          </div>
          <span className="text-lg font-bold tabular-nums" aria-live="polite">
            {formatPrice(total, currency)}
          </span>
        </div>
        <button
          type="button"
          onClick={onCheckout}
          disabled={disabled}
          aria-label={label}
          className="min-h-12 w-full rounded-2xl px-4 py-3 text-sm font-bold text-white transition-opacity duration-200 active:opacity-90 disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-primary)] motion-reduce:transition-none"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {label}
        </button>
      </div>
    </div>
  );
}
