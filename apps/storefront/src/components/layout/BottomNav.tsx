'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCartStore } from '@/stores/cartStore';

interface Tab {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
  icon: (active: boolean) => React.ReactNode;
  badge?: () => number;
}

// Emoji plutôt qu'icônes Tabler : décision de plateforme inversée (voir
// LEPEFY_PROJECT_CONTEXT.md §12, qui documentait le choix inverse) — la
// nav du bas est vitrine client, pas dashboard admin.
function NavEmoji({ emoji, active }: { emoji: string; active: boolean }) {
  return (
    <span
      className="text-2xl leading-none transition-opacity"
      style={{ opacity: active ? 1 : 0.6 }}
      aria-hidden="true"
    >
      {emoji}
    </span>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const totalItems = useCartStore((s) => s.totalItems());

  const tabs: Tab[] = [
    {
      href: '/',
      label: 'Accueil',
      isActive: (p) => p === '/',
      icon: (active) => <NavEmoji emoji="🏠" active={active} />,
    },
    {
      href: '/products',
      label: 'Catalogue',
      isActive: (p) => p === '/products' || p.startsWith('/products/'),
      icon: (active) => <NavEmoji emoji="🛍️" active={active} />,
    },
    {
      href: '/cart',
      label: 'Panier',
      isActive: (p) => p === '/cart',
      icon: (active) => <NavEmoji emoji="🛒" active={active} />,
      badge: () => totalItems,
    },
    {
      href: '/orders',
      label: 'Commandes',
      isActive: (p) => p === '/orders' || p.startsWith('/orders/'),
      icon: (active) => <NavEmoji emoji="📦" active={active} />,
    },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 w-full bg-white border-t border-gray-100 shadow-[0_-2px_10px_rgba(0,0,0,0.08)] z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch h-16">
        {tabs.map((tab) => {
          const active = tab.isActive(pathname);
          const badgeCount = tab.badge ? tab.badge() : 0;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex-1 flex flex-col items-center justify-center gap-0.5"
              style={{ color: active ? 'var(--color-primary)' : '#9ca3af' }}
            >
              <div className="relative">
                {tab.icon(active)}
                {badgeCount > 0 && (
                  <span
                    className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 rounded-full text-2xs font-bold flex items-center justify-center"
                    style={{ background: 'var(--color-secondary)', color: '#1a1a1a' }}
                  >
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </div>
              <span className={`text-2xs ${active ? 'font-medium' : 'font-normal'}`}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
