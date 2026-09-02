'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { IconLoader2, IconPhoto, IconShoppingCart } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { useCartStore } from '@/stores/cartStore';
import { useCartUiStore } from '@/stores/cartUiStore';
import {
  performNalaAddOnce,
  toNalaCartProduct,
  type NalaProductAction,
} from '@/lib/ai/nalaProductActionContract';

type ActionStatus = 'idle' | 'adding' | 'added' | 'error';

export function NalaProductActionCard({ action }: { action: NalaProductAction }) {
  const addItem = useCartStore((state) => state.addItem);
  const openCart = useCartUiStore((state) => state.openDrawer);
  const [status, setStatus] = useState<ActionStatus>('idle');
  const inFlightRef = useRef(new Set<string>());
  const hasDiscount = action.product.compareAtPrice != null
    && action.product.compareAtPrice > action.product.price;

  async function handleAdd() {
    if (status === 'adding' || status === 'added') return;
    setStatus('adding');
    try {
      const added = await performNalaAddOnce(
        inFlightRef.current,
        action.product.id,
        () => addItem(toNalaCartProduct(action), 1),
      );
      if (added) setStatus('added');
    } catch {
      setStatus('error');
    }
  }

  return (
    <article className="w-full overflow-hidden rounded-xl border border-[#DDD8FF] bg-white p-2.5 shadow-sm">
      <div className="flex min-w-0 gap-2.5">
        <Link
          href={`/products/${action.product.slug}`}
          aria-label={`${action.labels.viewProduct}: ${action.product.name}`}
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[#F1EFFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5AF6]"
        >
          {action.product.imageUrl ? (
            <Image
              src={action.product.imageUrl}
              alt=""
              fill
              sizes="56px"
              className="object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[#8B7CF6]">
              <IconPhoto size={22} aria-hidden="true" />
            </span>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <Link
            href={`/products/${action.product.slug}`}
            className="line-clamp-2 text-sm font-semibold leading-tight text-gray-900 hover:text-[#5947E8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5AF6]"
          >
            {action.product.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-bold text-[#5947E8]">
              {formatPrice(action.product.price, action.product.currency)}
            </span>
            {hasDiscount && (
              <span className="text-xs text-gray-400 line-through">
                {formatPrice(action.product.compareAtPrice as number, action.product.currency)}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 grid gap-1.5">
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={status === 'adding' || status === 'added'}
          className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5AF6] focus-visible:ring-offset-2 disabled:cursor-default ${status === 'added' ? 'bg-green-600' : 'bg-[#6D5AF6] hover:bg-[#4B3CC4] disabled:opacity-70'}`}
        >
          {status === 'adding' && <IconLoader2 size={17} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}
          {status === 'adding'
            ? action.labels.adding
            : status === 'added'
              ? action.labels.added
              : status === 'error'
                ? action.labels.retry
                : action.ctaLabel}
        </button>

        {status === 'added' && (
          <button
            type="button"
            onClick={openCart}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#CFC8FF] px-3 text-sm font-semibold text-[#5947E8] hover:bg-[#F3F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5AF6]"
          >
            <IconShoppingCart size={17} aria-hidden="true" />
            {action.labels.viewCart}
          </button>
        )}

        {status === 'error' && (
          <p role="alert" className="text-xs text-red-700">{action.labels.error}</p>
        )}
        <span className="sr-only" aria-live="polite">
          {status === 'added' ? action.labels.added : status === 'error' ? action.labels.error : ''}
        </span>
      </div>
    </article>
  );
}
