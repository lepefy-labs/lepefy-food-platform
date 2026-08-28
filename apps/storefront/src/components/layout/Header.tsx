'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconArrowLeft, IconLock, IconMenu2, IconShoppingCart } from '@tabler/icons-react';
import type { TenantSocialLink } from '@lepefy/types';
import { useTenant } from '@/providers/TenantProvider';
import { useCartStore } from '@/stores/cartStore';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import { TenantLogo } from '@/components/branding/TenantLogo';
import {
  BrandNavigationDrawer,
  type BrandNavigationSection,
} from '@/components/layout/BrandNavigationDrawer';

interface HeaderProps {
  socialLinks?: TenantSocialLink[];
  storyEnabled?: boolean;
}

export function Header({ socialLinks = [], storyEnabled = false }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const tenant = useTenant();
  const totalItems = useCartStore((s) => s.totalItems());
  const openCartDrawer = useCartUiStore((s) => s.openDrawer);
  const { customer } = useSessionCustomer();
  const isCheckout = pathname === '/checkout' || pathname.startsWith('/checkout/');
  const accountHref = customer ? '/compte' : '/compte/connexion';
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  function handleCartClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    closeMenu();
    openCartDrawer();
  }

  function isActive(href: string) {
    if (href === '/') return pathname === '/' || pathname.startsWith('/products/');
    if (href === '/accueil') return pathname === '/accueil';
    if (href === '/orders') return pathname === '/orders' || pathname.startsWith('/orders/');
    if (href.startsWith('/compte')) return pathname === '/compte' || pathname.startsWith('/compte/');
    return pathname === href;
  }

  const whatsappHref = tenant.whatsapp_number
    ? `https://wa.me/${tenant.whatsapp_number.replace(/\D/g, '')}`
    : null;

  const sections: BrandNavigationSection[] = [
    {
      id: 'explorer',
      label: 'Explorer',
      items: [
        { href: '/accueil', label: 'Découvrir', icon: 'home', activeWhen: ['/accueil'] },
        { href: '/', label: 'Catalogue', icon: 'category', activeWhen: ['/', '/products'] },
      ],
    },
    {
      id: 'services',
      label: 'Nos services',
      items: [
        ...(tenant.events_enabled
          ? [{ href: '/evenementiel#evenements', label: 'Événements', icon: 'event' as const, activeWhen: ['/evenementiel'] }]
          : []),
        ...(tenant.services_enabled
          ? [{ href: '/evenementiel#services', label: 'Traiteur & location', icon: 'tools' as const, activeWhen: ['/evenementiel/services'] }]
          : []),
        { href: '/card', label: 'Carte & paiement', icon: 'card', activeWhen: ['/card'] },
        ...(tenant.google_maps_url
          ? [{ href: tenant.google_maps_url, label: 'Nous trouver', icon: 'map' as const, external: true }]
          : []),
      ],
    },
    {
      id: 'account',
      label: 'Votre espace',
      intro: {
        title: customer ? 'Votre compte client' : 'Retrouvez vos achats',
        text: customer
          ? 'Commandes, profil et avantages au même endroit.'
          : 'Connectez-vous pour suivre vos commandes et votre compte.',
      },
      items: [
        { href: '/orders', label: 'Mes commandes', icon: 'orders', activeWhen: ['/orders'] },
        { href: accountHref, label: customer ? 'Mon compte' : 'Se connecter', icon: 'account', activeWhen: ['/compte'] },
      ],
    },
    {
      id: 'brand',
      label: tenant.name,
      items: [
        ...(storyEnabled
          ? [{ href: '/accueil#origine', label: 'Notre histoire', icon: 'home' as const }]
          : []),
        ...(whatsappHref
          ? [{ href: whatsappHref, label: 'Nous contacter', icon: 'message' as const, external: true }]
          : []),
      ],
    },
  ];

  if (isCheckout) {
    return (
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur">
        <div className="relative mx-auto flex h-[72px] max-w-2xl items-center justify-between px-4 sm:px-6">
          <Link href="/cart" aria-label="Retour au panier" className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
            <IconArrowLeft size={22} />
          </Link>
          <Link href="/" className="absolute left-1/2 -translate-x-1/2" aria-label={tenant.name}>
            <TenantLogo variant="compact" priority className="h-11 w-[140px] max-w-[38vw]" />
          </Link>
          <div className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
            <IconLock size={14} />
            <span className="hidden sm:inline">Paiement sécurisé</span>
          </div>
        </div>
      </header>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="relative mx-auto flex h-24 max-w-7xl items-center gap-3 px-4">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
            aria-controls="storefront-navigation-drawer"
            aria-label="Ouvrir le menu"
            className="absolute left-4 flex h-11 w-11 items-center justify-center rounded-lg text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] md:static md:order-last md:ml-1"
          >
            <IconMenu2 size={24} />
          </button>

          <Link href="/" className="absolute left-1/2 -translate-x-1/2 md:static md:translate-x-0" aria-label={tenant.name}>
            <TenantLogo variant="header" priority />
          </Link>

          <div className="ml-auto flex items-center gap-4">
            <Link
              href="/cart"
              onClick={handleCartClick}
              aria-haspopup="dialog"
              aria-label={`Ouvrir le panier${totalItems > 0 ? `, ${totalItems} article${totalItems > 1 ? 's' : ''}` : ''}`}
              className="absolute right-4 flex h-11 w-11 items-center justify-center rounded-lg text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] md:hidden"
            >
              <IconShoppingCart size={24} />
              {totalItems > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-0.5 text-2xs font-bold" style={{ background: 'var(--color-secondary)', color: '#1a1a1a' }}>
                  {totalItems > 99 ? '99+' : totalItems}
                </span>
              )}
            </Link>

            <nav className="hidden items-center gap-6 md:flex" aria-label="Navigation principale">
              <Link href="/" aria-current={isActive('/') ? 'page' : undefined} className={`text-sm font-medium transition-colors ${isActive('/') ? 'text-[var(--color-primary)]' : 'text-gray-700 hover:text-gray-900'}`}>Catalogue</Link>
              <Link href="/accueil" aria-current={isActive('/accueil') ? 'page' : undefined} className={`text-sm font-medium transition-colors ${isActive('/accueil') ? 'text-[var(--color-primary)]' : 'text-gray-700 hover:text-gray-900'}`}>Découvrir</Link>
              <Link href="/cart" onClick={handleCartClick} aria-haspopup="dialog" className="relative text-sm font-medium text-gray-700 hover:text-gray-900">
                Panier
                {totalItems > 0 && <span className="absolute -right-4 -top-2 flex h-5 w-5 items-center justify-center rounded-full text-xs text-white" style={{ backgroundColor: 'var(--color-primary)' }}>{totalItems}</span>}
              </Link>
              <Link href={accountHref} aria-current={isActive('/compte') ? 'page' : undefined} className={`relative text-sm font-medium transition-colors ${isActive('/compte') ? 'text-[var(--color-primary)]' : 'text-gray-700 hover:text-gray-900'}`}>
                Compte
                {customer && <span className="absolute -right-2.5 -top-1 h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />}
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <BrandNavigationDrawer
        id="storefront-navigation-drawer"
        open={menuOpen}
        onClose={closeMenu}
        tenant={tenant}
        sections={sections}
        socialLinks={socialLinks}
        side="responsive"
      />
    </>
  );
}
