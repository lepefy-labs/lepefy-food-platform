'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  IconSmartHome,
  IconCategory,
  IconShoppingBag,
  IconGift,
  IconUserCircle,
} from '@tabler/icons-react';
import { useCartStore } from '@/stores/cartStore';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import { useTenant } from '@/providers/TenantProvider';
import { cartAriaLabel, formatCartBadge } from '@/lib/cart/cartBadge';
import { useCartAddPulse, useCartNudge } from '@/lib/cart/useCartAttention';
import { accentTextOnWhite, readableOn } from '@/lib/utils/color';

interface Tab {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
  icon: (active: boolean) => React.ReactNode;
  dot?: () => boolean;
}

const INACTIVE_COLOR = '#4b5563';

export function BottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const goodiesContext = pathname.startsWith('/products/') && searchParams.get('from') === 'gadgets';
  const totalItems = useCartStore((s) => s.totalItems());
  const { customer } = useSessionCustomer();
  const tenant = useTenant();
  const pulsing = useCartAddPulse();
  const nudging = useCartNudge(pathname);

  if (pathname === '/avis/donner' || pathname === '/checkout' || pathname.startsWith('/checkout/')) return null;

  // Couleurs dérivées des tokens tenant, jamais fixées : icône et pastille
  // restent lisibles quel que soit le couple primary/secondary configuré.
  const activeColor = accentTextOnWhite(tenant.primary_color);
  const onPrimary = readableOn(tenant.primary_color);
  const onSecondary = readableOn(tenant.secondary_color, 4.5);
  const cartActive = pathname === '/cart';

  const leftTabs: Tab[] = [
    {
      href: '/accueil', label: 'Découvrir', isActive: (p) => p === '/accueil',
      icon: (active) => <IconSmartHome size={24} stroke={active ? 2 : 1.5} />,
    },
    {
      href: '/', label: 'Catalogue', isActive: (p) => p === '/' || (p.startsWith('/products/') && !goodiesContext),
      icon: (active) => <IconCategory size={24} stroke={active ? 2 : 1.5} />,
    },
  ];
  const rightTabs: Tab[] = [
    {
      href: '/gadgets', label: 'Goodies', isActive: (p) => p === '/gadgets' || p.startsWith('/gadgets/') || goodiesContext,
      icon: (active) => <IconGift size={24} stroke={active ? 2 : 1.5} />,
    },
    {
      href: '/compte/connexion', label: 'Compte', isActive: (p) => p === '/compte' || p.startsWith('/compte/'),
      icon: (active) => <IconUserCircle size={24} stroke={active ? 2 : 1.5} />, dot: () => !!customer,
    },
  ];

  function renderTab(tab: Tab) {
    const active = tab.isActive(pathname);
    const showDot = tab.dot ? tab.dot() : false;
    return (
      <Link key={tab.href} href={tab.href} aria-current={active ? 'page' : undefined}
        className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)]"
        style={{ color: active ? activeColor : INACTIVE_COLOR }}>
        <span className="relative">
          {tab.icon(active)}
          {showDot && <span className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />}
        </span>
        <span className={`max-w-full truncate text-xs leading-tight ${active ? 'font-bold' : 'font-medium'}`}>{tab.label}</span>
      </Link>
    );
  }

  return (
    <nav aria-label="Navigation boutique" className="fixed bottom-0 left-0 right-0 z-50 w-full border-t border-gray-100 bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.08)] md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex h-16 items-stretch">
        {leftTabs.map(renderTab)}
        {/* Panier : voix centrale mise en avant, entièrement contenue dans la
            barre (aucun débordement sur la barre d'achat de la fiche produit). */}
        <Link href="/cart" aria-current={cartActive ? 'page' : undefined} aria-label={cartAriaLabel(totalItems)}
          className="flex min-w-0 flex-1 flex-col items-center justify-start gap-0.5 pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)]">
          <span
            className={`relative flex h-11 w-11 items-center justify-center rounded-full motion-reduce:animate-none ${pulsing ? 'animate-cart-pop' : nudging ? 'animate-cart-nudge' : ''}`}
            style={{
              backgroundColor: 'var(--color-primary)',
              color: onPrimary,
              boxShadow: cartActive
                ? '0 0 0 3px #fff, 0 0 0 5px var(--color-primary)'
                : '0 0 0 3px #fff, 0 4px 10px color-mix(in srgb, var(--color-primary) 40%, transparent)',
            }}
          >
            <IconShoppingBag size={26} stroke={2} aria-hidden="true" />
            {totalItems > 0 && (
              <span aria-hidden="true"
                className="absolute -right-2.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs font-extrabold tabular-nums ring-2 ring-white"
                style={{ background: 'var(--color-secondary)', color: onSecondary }}>
                {formatCartBadge(totalItems)}
              </span>
            )}
          </span>
          <span className={`text-xs leading-tight ${cartActive ? 'font-extrabold' : 'font-semibold'}`} style={{ color: cartActive ? activeColor : '#111827' }}>Panier</span>
        </Link>
        {rightTabs.map(renderTab)}
      </div>
    </nav>
  );
}
