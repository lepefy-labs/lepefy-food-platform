'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconSmartHome,
  IconCategory,
  IconShoppingBag,
  IconTruckDelivery,
  IconUserCircle,
} from '@tabler/icons-react';
import { useCartStore } from '@/stores/cartStore';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';

interface Tab {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
  icon: (active: boolean) => React.ReactNode;
  badge?: () => number;
  dot?: () => boolean;
}

export function BottomNav() {
  const pathname = usePathname();
  const totalItems = useCartStore((s) => s.totalItems());
  const { customer } = useSessionCustomer();

  if (pathname === '/checkout' || pathname.startsWith('/checkout/')) return null;

  const tabs: Tab[] = [
    {
      href: '/accueil', label: 'Découvrir', isActive: (p) => p === '/accueil',
      icon: (active) => <IconSmartHome size={24} stroke={active ? 2 : 1.5} />,
    },
    {
      href: '/', label: 'Catalogue', isActive: (p) => p === '/' || p.startsWith('/products/'),
      icon: (active) => <IconCategory size={24} stroke={active ? 2 : 1.5} />,
    },
    {
      href: '/cart', label: 'Panier', isActive: (p) => p === '/cart',
      icon: (active) => <IconShoppingBag size={24} stroke={active ? 2 : 1.5} />, badge: () => totalItems,
    },
    {
      href: '/orders', label: 'Commandes', isActive: (p) => p === '/orders' || p.startsWith('/orders/'),
      icon: (active) => <IconTruckDelivery size={24} stroke={active ? 2 : 1.5} />,
    },
    {
      href: '/compte/connexion', label: 'Compte', isActive: (p) => p === '/compte' || p.startsWith('/compte/'),
      icon: (active) => <IconUserCircle size={24} stroke={active ? 2 : 1.5} />, dot: () => !!customer,
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 w-full border-t border-gray-100 bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.08)] md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex h-16 items-stretch">
        {tabs.map((tab) => {
          const active = tab.isActive(pathname);
          const badgeCount = tab.badge ? tab.badge() : 0;
          const showDot = tab.dot ? tab.dot() : false;
          return (
            <Link key={tab.href} href={tab.href} className="flex flex-1 flex-col items-center justify-center gap-0.5" style={{ color: active ? 'var(--color-primary)' : '#9ca3af' }}>
              <div className="relative">
                {tab.icon(active)}
                {badgeCount > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-0.5 text-2xs font-bold" style={{ background: 'var(--color-secondary)', color: '#1a1a1a' }}>{badgeCount > 99 ? '99+' : badgeCount}</span>}
                {showDot && <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />}
              </div>
              <span className={`text-2xs ${active ? 'font-medium' : 'font-normal'}`}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
