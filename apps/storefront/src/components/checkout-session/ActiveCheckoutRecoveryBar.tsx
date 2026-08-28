'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconArrowRight, IconShoppingCart } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';

export function ActiveCheckoutRecoveryBar({
  sessionId,
  itemCount,
  total,
  currency,
}: {
  sessionId: string;
  itemCount: number;
  total: number;
  currency: string;
}) {
  const pathname = usePathname();
  const visible = pathname === '/' || pathname === '/cart' || pathname === '/compte' || pathname === '/orders';

  if (!visible) return null;

  return (
    <div className="border-b border-amber-200 bg-amber-50/95 px-4 py-2.5 text-amber-950">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-amber-700 shadow-sm">
            <IconShoppingCart size={16} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Vous avez un achat à terminer</p>
            <p className="truncate text-xs text-amber-800/70">
              {itemCount} article{itemCount > 1 ? 's' : ''} · {formatPrice(total, currency)}
            </p>
          </div>
        </div>
        <Link
          href={`/checkout/reprendre/${sessionId}`}
          className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-amber-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2"
        >
          Continuer <IconArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
