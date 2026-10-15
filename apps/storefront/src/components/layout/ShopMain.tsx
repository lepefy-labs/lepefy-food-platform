'use client';

import { usePathname } from 'next/navigation';
import { shouldShowBottomNav } from '@/lib/storefront/shopChrome';

export function ShopMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isReview = pathname === '/avis/donner';
  // Réserve la hauteur de la BottomNav seulement quand elle est affichée.
  const reserveBottomNav = shouldShowBottomNav(pathname);

  return (
    <main
      className={isReview ? 'flex-1 bg-slate-50' : reserveBottomNav ? 'flex-1 pb-20 md:pb-0' : 'flex-1'}
      style={isReview ? { fontFamily: 'var(--font-inter), system-ui, sans-serif' } : undefined}
    >
      {children}
    </main>
  );
}
