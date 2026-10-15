'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import { getShoppingReturn, markShoppingReturn } from '@/lib/catalog/shoppingReturn';
import { ACTION_COPY } from '@/lib/storefrontCopy/copy';
import { formatProductCount } from '@/lib/cart/formatProductCount';

/**
 * En-tête contextuel du panier, collant, une seule ligne : « ← » vers le
 * catalogue du tenant (recherche, catégorie, tri et position d'où le client
 * vient, `shoppingReturn.ts`, jamais l'historique du navigateur), le titre
 * « Mon panier » et le nombre de produits. Sur mobile il remplace l'en-tête
 * commercial (`isCartPath`) ; à partir de md il se place sous l'en-tête global
 * collant et la flèche devient « ← Continuer mes achats ».
 * `itemCount` vaut null tant que le panier (localStorage) n'est pas hydraté.
 * `children` (la recherche du panier) reste dans le même bloc collant, sous le titre.
 */
export function CartPageHeader({ itemCount, children }: { itemCount: number | null; children?: React.ReactNode }) {
  // Lu après l'hydratation (sessionStorage) ; le catalogue par défaut sinon.
  const [href, setHref] = useState('/');
  useEffect(() => { setHref(getShoppingReturn('/')); }, []);

  return (
    <div className="sticky top-0 z-30 -mx-4 border-b border-gray-200 bg-white/95 px-1 backdrop-blur motion-reduce:backdrop-blur-none sm:-mx-6 sm:px-3 md:top-24 md:mb-3 lg:-mx-8 lg:px-5">
      <div className="flex min-h-14 items-center gap-1">
        <Link
          href={href}
          scroll={false}
          onClick={markShoppingReturn}
          aria-label={ACTION_COPY.continueShopping}
          className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-bold text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] md:px-2"
        >
          <IconArrowLeft size={22} aria-hidden="true" />
          <span className="hidden md:inline" aria-hidden="true">{ACTION_COPY.continueShopping}</span>
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-display text-lg font-bold text-gray-950 md:ml-2 md:border-l md:border-gray-200 md:pl-4 md:text-xl">Mon panier</h1>
        {itemCount !== null && itemCount > 0 && (
          <span className="shrink-0 pr-3 text-sm font-semibold text-gray-700">{formatProductCount(itemCount)}</span>
        )}
      </div>
      {children && <div className="px-3 pb-2.5 sm:px-3 lg:px-3">{children}</div>}
    </div>
  );
}
