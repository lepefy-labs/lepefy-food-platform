'use client';

import { Suspense } from 'react';
import { usePathname } from 'next/navigation';
import { IconSearch } from '@tabler/icons-react';
import { shouldShowGlobalSearch } from '@/lib/storefront/shopChrome';
import { GlobalProductSearch } from './GlobalProductSearch';

/** Même gabarit que le champ réel : le rendu statique (ISR) ne décale rien à l'hydratation. */
export function SearchFieldPlaceholder({ variant }: { variant: 'bar' | 'header' }) {
  return (
    <div aria-hidden="true"
      className={`flex items-center gap-3 border-[1.5px] border-[color:var(--field-border)] bg-[color:var(--field-bg)] text-base text-[color:var(--field-placeholder)] ${variant === 'header' ? 'h-11 rounded-xl px-3' : 'h-[52px] rounded-xl px-4'}`}>
      <IconSearch size={20} className="shrink-0 text-gray-600" />
      Rechercher un produit...
    </div>
  );
}

/**
 * Barre de recherche mobile/tablette, juste sous l'header : seul élément du
 * haut qui reste fixé au défilement sur mobile (l'header défile, la BottomNav
 * garde les destinations). Sur desktop le champ vit dans l'header.
 */
export function ShopSearchBar() {
  const pathname = usePathname();
  if (!shouldShowGlobalSearch(pathname)) return null;

  return (
    <div className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur motion-reduce:backdrop-blur-none md:top-24 lg:hidden">
      <div className="mx-auto max-w-6xl px-4 py-2">
        <div className="max-w-2xl">
          <Suspense fallback={<SearchFieldPlaceholder variant="bar" />}>
            <GlobalProductSearch variant="bar" />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
