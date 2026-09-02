'use client';

import Image from 'next/image';
import { useMemo, useRef, useState } from 'react';
import {
  IconCircle,
  IconCircleCheck,
  IconLoader2,
  IconPhoto,
  IconShoppingCart,
  IconSparkles,
} from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { useCartStore } from '@/stores/cartStore';
import { useCartUiStore } from '@/stores/cartUiStore';
import {
  performNalaBulkAdd,
  toNalaCartPlanProduct,
  type NalaBulkAddResult,
  type NalaCartPlan,
  type NalaCartPlanItem,
} from '@/lib/ai/nalaCartPlanContract';

type BulkStatus = 'idle' | 'adding' | 'complete';

export function NalaCartPlanCard({
  plan,
  expanded,
  onPrepare,
}: {
  plan: NalaCartPlan;
  expanded: boolean;
  onPrepare: () => void;
}) {
  const addItem = useCartStore((state) => state.addItem);
  const openCart = useCartUiStore((state) => state.openDrawer);
  const initialSelection = useMemo(() => new Set(
    plan.items.flatMap((item) => (
      item.product && item.selectedByDefault ? [item.product.id] : []
    )),
  ), [plan.items]);
  const [selectedIds, setSelectedIds] = useState(initialSelection);
  const [status, setStatus] = useState<BulkStatus>('idle');
  const [result, setResult] = useState<NalaBulkAddResult | null>(null);
  const inFlightRef = useRef(new Set<string>());

  const selectedItems = plan.items.filter((item) => (
    item.product && selectedIds.has(item.product.id)
  ));
  const selectedSubtotal = selectedItems.reduce(
    (sum, item) => sum + (item.product?.price ?? 0),
    0,
  );
  const failedItems = result
    ? plan.items.filter((item) => item.product && result.failedIds.includes(item.product.id))
    : [];

  function toggleItem(item: NalaCartPlanItem) {
    const productId = item.product?.id;
    if (!productId || status === 'adding') return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  async function addSelected(items = selectedItems) {
    if (items.length === 0 || status === 'adding') return;
    setStatus('adding');
    const ids = new Set(items.flatMap((item) => item.product ? [item.product.id] : []));
    const nextResult = await performNalaBulkAdd({
      inFlight: inFlightRef.current,
      planId: plan.id,
      items,
      selectedIds: ids,
      addItem: (item) => {
        const product = toNalaCartPlanProduct(item);
        if (!product) throw new Error('unavailable');
        addItem(product, 1);
      },
    });
    if (nextResult) {
      setResult((previous) => ({
        addedIds: [...new Set([...(previous?.addedIds ?? []), ...nextResult.addedIds])],
        failedIds: nextResult.failedIds,
      }));
      setStatus('complete');
    }
  }

  if (!expanded) {
    return (
      <article className="w-full rounded-xl border border-[#DDD8FF] bg-white p-3 shadow-sm">
        <div className="flex items-start gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F1EFFF] text-[#6D5AF6]">
            <IconSparkles size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">Panier {plan.title}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-600">
              {plan.totals.availableItems} {plan.labels.productsFound} · {plan.totals.unavailableItems} {plan.labels.unavailableCount}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onPrepare}
          className="mt-3 flex min-h-11 w-full items-center justify-center rounded-lg bg-[#6D5AF6] px-3 text-sm font-semibold text-white hover:bg-[#4B3CC4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5AF6] focus-visible:ring-offset-2"
        >
          {plan.labels.prepare}
        </button>
      </article>
    );
  }

  return (
    <article className="w-full overflow-hidden rounded-xl border border-[#DDD8FF] bg-white shadow-sm">
      <div className="px-3 py-3">
        <h3 className="text-sm font-semibold text-gray-900">{plan.labels.basketTitle} {plan.title}</h3>
        <p className="mt-0.5 text-xs text-gray-500">{plan.labels.selectionHelp}</p>
      </div>

      <div className="border-t border-[#EEEAF8]">
        {plan.items.map((item, index) => {
          const productId = item.product?.id;
          const selected = Boolean(productId && selectedIds.has(productId));
          const unavailable = item.status === 'unavailable' || !item.product;
          return (
            <label
              key={`${item.ingredientName}:${productId ?? index}`}
              className={`flex min-h-14 items-center gap-2.5 border-b border-[#EEEAF8] px-3 py-2 ${unavailable ? 'cursor-default bg-gray-50' : 'cursor-pointer hover:bg-[#FAF9FF]'}`}
            >
              {unavailable ? (
                <IconCircle size={18} aria-hidden="true" className="shrink-0 text-gray-400" />
              ) : (
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={status === 'adding'}
                  onChange={() => toggleItem(item)}
                  className="h-5 w-5 shrink-0 accent-[#6D5AF6] focus-visible:ring-2 focus-visible:ring-[#6D5AF6]"
                  aria-label={`Inclure ${item.product?.name}`}
                />
              )}

              <span className="relative flex h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[#F1EFFF]">
                {item.product?.imageUrl ? (
                  <Image
                    src={item.product.imageUrl}
                    alt=""
                    fill
                    sizes="40px"
                    className="object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[#8B7CF6]">
                    <IconPhoto size={18} aria-hidden="true" />
                  </span>
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className={`line-clamp-2 text-xs font-medium leading-tight ${unavailable ? 'text-gray-500' : 'text-gray-900'}`}>
                  {item.product?.name ?? item.ingredientName}
                </span>
                {item.status === 'substitute' && (
                  <span className="mt-0.5 block text-[11px] font-medium text-amber-700">
                    {plan.labels.substitute}
                  </span>
                )}
                {unavailable && (
                  <span className="mt-0.5 block text-[11px] text-gray-500">
                    {plan.labels.unavailable}
                  </span>
                )}
              </span>

              <span className="shrink-0 text-xs font-semibold text-[#5947E8]">
                {item.product ? formatPrice(item.product.price, item.product.currency) : '—'}
              </span>
            </label>
          );
        })}
      </div>

      <div className="p-3">
        <div className="mb-2.5 flex items-center justify-between gap-3 text-xs text-gray-600">
          <span>{selectedItems.length} {plan.labels.productsFound} · {plan.labels.indicativeTotal}</span>
          <strong className="text-sm text-gray-900">
            {formatPrice(selectedSubtotal, plan.currency)}
          </strong>
        </div>

        {status !== 'complete' && (
          <button
            type="button"
            onClick={() => void addSelected()}
            disabled={status === 'adding' || selectedItems.length === 0}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#6D5AF6] px-3 text-sm font-semibold text-white hover:bg-[#4B3CC4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5AF6] focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-50"
          >
            {status === 'adding' && (
              <IconLoader2 size={17} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            )}
            {status === 'adding'
              ? plan.labels.adding
              : `${plan.labels.addProducts} (${selectedItems.length})`}
          </button>
        )}

        {status === 'complete' && result && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-green-700">
              <IconCircleCheck size={18} aria-hidden="true" />
              {result.addedIds.length} {plan.labels.productsAdded}
            </p>
            {result.failedIds.length > 0 && (
              <>
                <p role="alert" className="text-xs text-red-700">
                  {result.failedIds.length} {plan.labels.productFailed}
                </p>
                <button
                  type="button"
                  onClick={() => void addSelected(failedItems)}
                  className="flex min-h-11 w-full items-center justify-center rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  {plan.labels.retryFailed}
                </button>
              </>
            )}
            {result.addedIds.length > 0 && (
              <button
                type="button"
                onClick={openCart}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#CFC8FF] px-3 text-sm font-semibold text-[#5947E8] hover:bg-[#F3F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D5AF6]"
              >
                <IconShoppingCart size={17} aria-hidden="true" />
                {plan.labels.viewCart}
              </button>
            )}
          </div>
        )}

        <span className="sr-only" aria-live="polite">
          {status === 'complete' && result
            ? `${result.addedIds.length} ${plan.labels.productsAdded}. ${result.failedIds.length} ${plan.labels.productFailed}.`
            : ''}
        </span>
      </div>
    </article>
  );
}
