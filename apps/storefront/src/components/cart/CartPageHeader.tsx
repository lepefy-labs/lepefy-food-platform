'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import { getShoppingReturn, markShoppingReturn } from '@/lib/catalog/shoppingReturn';
import { ACTION_COPY } from '@/lib/storefrontCopy/copy';
import { formatProductCount } from '@/lib/cart/formatProductCount';

/**
 * En-tête contextuel du panier. Partie collante : « ← Continuer mes achats »
 * écrit en toutes lettres (vers le catalogue du tenant, avec la recherche, la
 * catégorie, le tri et la position d'où le client vient, `shoppingReturn.ts`,
 * jamais l'historique du navigateur) et le nombre de produits, puis la
 * recherche du panier (`children`). Le titre « Mon panier » suit, hors de la
 * zone collante, pour garder le haut d'écran fixe le plus bas possible. Sur
 * mobile il remplace l'en-tête commercial (`isCartPath`) ; à partir de md il
 * se place sous l'en-tête global collant.
 * `itemCount` vaut null tant que le panier (localStorage) n'est pas hydraté.
 */
export function CartPageHeader({ itemCount, children }: { itemCount: number | null; children?: React.ReactNode }) {
  // Lu après l'hydratation (sessionStorage) ; le catalogue par défaut sinon.
  const [href, setHref] = useState('/');
  useEffect(() => { setHref(getShoppingReturn('/')); }, []);

  return (
    <>
      <div className="sticky top-0 z-30 -mx-4 border-b border-gray-200 bg-white/95 backdrop-blur motion-reduce:backdrop-blur-none sm:-mx-6 md:top-24 lg:-mx-8">
        <div className="flex min-h-12 items-center justify-between gap-2 pl-1 pr-4 sm:pl-3 sm:pr-6 lg:pl-5 lg:pr-8">
          <Link
            href={href}
            scroll={false}
            onClick={markShoppingReturn}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[15px] font-bold text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <IconArrowLeft size={20} aria-hidden="true" /> {ACTION_COPY.continueShopping}
          </Link>
          {itemCount !== null && itemCount > 0 && (
            <span className="shrink-0 text-sm font-semibold text-gray-700">{formatProductCount(itemCount)}</span>
          )}
        </div>
        {children && <div className="px-4 pb-2.5 sm:px-6 lg:px-8">{children}</div>}
      </div>
      <h1 className="pb-1 pt-4 font-display text-xl font-bold text-gray-950 md:pt-5 md:text-2xl">Mon panier</h1>
    </>
  );
}
