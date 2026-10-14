'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import { getShoppingReturn, markShoppingReturn } from '@/lib/catalog/shoppingReturn';
import { ACTION_COPY } from '@/lib/storefrontCopy/copy';
import { formatProductCount } from '@/lib/cart/formatProductCount';

/**
 * Haut du panier, collant : « ← Continuer mes achats » vers le catalogue du
 * tenant, avec la recherche, la catégorie, le tri et la position d'où le
 * client vient (`shoppingReturn.ts`), jamais l'historique du navigateur.
 * Seul élément collant du haut sur mobile (la recherche y est masquée) ;
 * sous l'en-tête collant à partir de md. Le panier n'est jamais modifié.
 */
export function CartReturnBar({ itemCount }: { itemCount: number }) {
  // Lu après l'hydratation (sessionStorage) ; le catalogue par défaut sinon.
  const [href, setHref] = useState('/');
  useEffect(() => { setHref(getShoppingReturn('/')); }, []);

  return (
    <div className="sticky top-0 z-30 -mx-4 mb-3 border-b border-gray-200 bg-white/95 px-2 backdrop-blur motion-reduce:backdrop-blur-none sm:-mx-6 sm:px-4 md:top-24 lg:-mx-8 lg:px-6">
      <div className="flex min-h-14 items-center justify-between gap-3">
        <Link
          href={href}
          scroll={false}
          onClick={markShoppingReturn}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-bold text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          <IconArrowLeft size={18} aria-hidden="true" /> {ACTION_COPY.continueShopping}
        </Link>
        <span className="pr-2 text-sm font-semibold text-gray-700" aria-hidden="true">{formatProductCount(itemCount)}</span>
      </div>
    </div>
  );
}
