'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CartItem } from '@lepefy/types';
import type { ProductFormatsResponse } from '@/app/api/products/formats/route';
import {
  buildSaleFormatOptions,
  proposeFormatSwap,
  type FormatSwapProposal,
  type SaleFormatOption,
} from '@/lib/catalog/saleFormats';
import { toFormatCartProduct } from './saleFormatCart';
import { useCartStore } from '@/stores/cartStore';

export interface CartFormatSwap {
  proposal: FormatSwapProposal;
  apply: () => boolean;
}

/**
 * Propositions « Passer au lot et économiser X € » du panier (migration 187).
 * Lit les formats frais des fiches du panier en une requête par visite
 * (la réponse ne contient que les fiches qui ont des formats). Une proposition n'existe que si le
 * lot est en vente, achetable et moins cher : sinon rien ne s'affiche.
 */
export function useCartFormatSwaps(items: CartItem[]): Map<string, CartFormatSwap> {
  // Toutes les fiches du panier : une ligne enregistrée avant l'ajout d'un lot
  // n'a pas encore de libellé de format, la proposition doit pourtant apparaître.
  const parentIds = useMemo(() => Array.from(new Set(items
    .map((item) => item.product.format_parent_id ?? item.product.id)
    .filter((id): id is string => Boolean(id)))).sort().slice(0, 50).join(','), [items]);
  const [fresh, setFresh] = useState<{ key: string; products: ProductFormatsResponse['products'] } | null>(null);

  useEffect(() => {
    if (!parentIds) return;
    const controller = new AbortController();
    fetch(`/api/products/formats?ids=${encodeURIComponent(parentIds)}`, { signal: controller.signal })
      .then(async (res) => (res.ok ? res.json() as Promise<ProductFormatsResponse> : null))
      .then((data) => { if (data && !controller.signal.aborted) setFresh({ key: parentIds, products: data.products ?? [] }); })
      .catch(() => { /* Sans données fraîches, aucune proposition : jamais un prix deviné. */ });
    return () => controller.abort();
  }, [parentIds]);

  return useMemo(() => {
    const swaps = new Map<string, CartFormatSwap>();
    if (!fresh || fresh.key !== parentIds) return swaps;
    const lines = new Map(items.map((item) => [item.product.id, item.quantity]));
    for (const parent of fresh.products) {
      const baseLine = items.find((item) => item.product.id === parent.id);
      if (!baseLine) continue;
      const options: SaleFormatOption[] = buildSaleFormatOptions(parent);
      const baseOption = options.find((option) => option.isBase);
      if (!baseOption) continue;
      const proposal = proposeFormatSwap(
        { productId: parent.id, quantity: baseLine.quantity, price: baseOption.price, minimum: baseOption.minimum, step: baseOption.step },
        options,
        lines,
      );
      if (!proposal) continue;
      const option = options.find((entry) => entry.id === proposal.formatId)!;
      swaps.set(parent.id, {
        proposal,
        apply: () => useCartStore.getState().swapToFormat(
          parent.id,
          toFormatCartProduct(parent, option),
          proposal.formatQuantity,
          proposal.baseQuantity,
        ),
      });
    }
    return swaps;
  }, [fresh, parentIds, items]);
}
