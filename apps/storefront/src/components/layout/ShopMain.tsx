'use client';

import { usePathname } from 'next/navigation';

export function ShopMain({ children }: { children: React.ReactNode }) {
  const isReview = usePathname() === '/avis/donner';

  return (
    <main
      className={isReview ? 'flex-1 bg-slate-50' : 'flex-1 pb-20 md:pb-0'}
      style={isReview ? { fontFamily: 'var(--font-inter), system-ui, sans-serif' } : undefined}
    >
      {children}
    </main>
  );
}
