'use client';

import { Suspense, useCallback, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { IconArrowLeft, IconLock, IconMenu2, IconShoppingCart, IconStar } from '@tabler/icons-react';
import type { TenantSocialLink } from '@lepefy/types';
import { useTenant } from '@/providers/TenantProvider';
import { useHydratedCartCount } from '@/lib/cart/useHydratedCart';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import { TenantLogo } from '@/components/branding/TenantLogo';
import { GlobalProductSearch } from '@/components/search/GlobalProductSearch';
import { SearchFieldPlaceholder } from '@/components/search/ShopSearchBar';
import { cartAriaLabel, formatCartBadge } from '@/lib/cart/cartBadge';
import { useCartAddPulse } from '@/lib/cart/useCartAttention';
import { isCartPath, shouldShowGlobalSearch } from '@/lib/storefront/shopChrome';
import { readableOn } from '@/lib/utils/color';
// Sous-domaine événementiel quand il existe : ses liens courts (/services/…) n'existent pas sur la boutique.
import { eventsHubHref } from '@/lib/events/eventsHubUrl';
import { shopLinkPrefetch } from '@/lib/storefront/linkPrefetch';
import {
  BrandNavigationDrawer,
  type BrandNavigationSection,
} from '@/components/layout/BrandNavigationDrawer';

interface HeaderProps {
  socialLinks?: TenantSocialLink[];
  storyEnabled?: boolean;
  reviewsAvailable?: boolean;
}

export function Header({ socialLinks = [], storyEnabled = false, reviewsAvailable = false }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const goodiesContext = pathname.startsWith('/products/') && searchParams.get('from') === 'gadgets';
  const tenant = useTenant();
  const totalItems = useHydratedCartCount();
  const openCartDrawer = useCartUiStore((s) => s.openDrawer);
  const cartPulse = useCartAddPulse();
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
    if (href === '/') return pathname === '/' || (pathname.startsWith('/products/') && !goodiesContext);
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
        { href: '/', label: 'Catalogue', icon: 'category', active: isActive('/') },
        { href: '/gadgets', label: 'Goodies', icon: 'goodies', active: goodiesContext || pathname === '/gadgets' || pathname.startsWith('/gadgets/') },
      ],
    },
    {
      id: 'services',
      label: 'Nos services',
      items: [
        ...(tenant.events_enabled
          ? [{ href: eventsHubHref('evenements'), label: 'Événements', icon: 'event' as const, activeWhen: ['/evenementiel'] }]
          : []),
        ...(tenant.services_enabled
          ? [{ href: eventsHubHref('services'), label: 'Traiteur & location', icon: 'tools' as const, activeWhen: ['/evenementiel/services'] }]
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

  if (pathname === '/avis/donner') {
    return (
      <header className="border-b border-slate-200 bg-white" style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4 sm:h-[72px] sm:px-6">
          <Link href="/" prefetch={false} aria-label={tenant.name}>
            <TenantLogo variant="compact" priority className="h-11 w-20 max-w-[30vw] sm:w-[120px]" />
          </Link>
          <Link href="/" prefetch={false} className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-1 text-xs font-medium text-slate-600 hover:text-slate-950 sm:text-sm">
            <IconArrowLeft size={16} aria-hidden="true" /> Retour à la boutique
          </Link>
        </div>
      </header>
    );
  }

  if (isCheckout) {
    return (
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur">
        <div className="relative mx-auto flex h-[72px] max-w-2xl items-center justify-between px-4 sm:px-6">
          <Link href="/cart" prefetch={false} aria-label="Retour au panier" className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
            <IconArrowLeft size={22} />
          </Link>
          <Link href="/" prefetch={false} className="absolute left-1/2 -translate-x-1/2" aria-label={tenant.name}>
            <TenantLogo variant="compact" priority className="h-11 w-[140px] max-w-[38vw]" />
          </Link>
          <div className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-gray-500">
            <IconLock size={14} />
            <span className="hidden sm:inline">Paiement sécurisé</span>
          </div>
        </div>
      </header>
    );
  }

  const onPrimary = readableOn(tenant.primary_color);
  const onSecondary = readableOn(tenant.secondary_color, 4.5);
  const showSearch = shouldShowGlobalSearch(pathname);

  return (
    <>
      {/* Mobile : l'header défile avec la page, seule la recherche reste fixée
          (ShopSearchBar) et la BottomNav porte panier et destinations. Sur le
          panier mobile, l'en-tête contextuel de la page (CartPageHeader) le remplace. */}
      <header className={`relative z-40 border-b border-gray-200 bg-white md:sticky md:top-0 ${isCartPath(pathname) ? 'max-md:hidden' : ''}`}>
        <div className="relative mx-auto flex h-24 max-w-7xl items-center gap-3 px-4 lg:gap-6">
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

          <Link href="/" prefetch={false} className="absolute left-[46%] -translate-x-1/2 md:static md:shrink-0 md:translate-x-0" aria-label={tenant.name}>
            <TenantLogo variant="header" priority className="!max-w-[40vw] md:!max-w-none" />
          </Link>

          {showSearch && (
            <div className="hidden min-w-0 max-w-xl flex-1 lg:block">
              <Suspense fallback={<SearchFieldPlaceholder variant="header" />}>
                <GlobalProductSearch variant="header" />
              </Suspense>
            </div>
          )}

          <div className="ml-auto flex min-w-0 items-center gap-4">
            {reviewsAvailable && (
              <Link href="/avis" aria-label="Voir les avis clients" aria-current={pathname === '/avis' ? 'page' : undefined}
                className="absolute right-4 flex h-11 w-11 flex-col items-center justify-center rounded-lg text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] md:hidden">
                <IconStar size={23} stroke={2} aria-hidden="true" />
                <span className="text-xs font-semibold leading-none text-gray-700">Avis</span>
              </Link>
            )}

            {/* Catalogue, panier, compte : pages dynamiques, sans prefetch spéculatif (lib/storefront/linkPrefetch.ts). */}
            <nav className="hidden items-center gap-4 md:flex lg:gap-6" aria-label="Navigation principale">
              <Link href="/" prefetch={false} aria-current={isActive('/') ? 'page' : undefined} className={`text-sm font-medium transition-colors ${isActive('/') ? 'text-[var(--color-primary)]' : 'text-gray-700 hover:text-gray-900'}`}>Catalogue</Link>
              <Link href="/accueil" aria-current={isActive('/accueil') ? 'page' : undefined} className={`text-sm font-medium transition-colors ${isActive('/accueil') ? 'text-[var(--color-primary)]' : 'text-gray-700 hover:text-gray-900'}`}>Découvrir</Link>
              {reviewsAvailable && <Link href="/avis" aria-current={pathname === '/avis' ? 'page' : undefined} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"><IconStar size={19} stroke={2} className="text-amber-500" aria-hidden="true" />Avis</Link>}
              <Link href={accountHref} prefetch={shopLinkPrefetch(accountHref)} aria-current={isActive('/compte') ? 'page' : undefined} className={`relative text-sm font-medium transition-colors ${isActive('/compte') ? 'text-[var(--color-primary)]' : 'text-gray-700 hover:text-gray-900'}`}>
                Compte
                {customer && <span className="absolute -right-2.5 -top-1 h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />}
              </Link>
              <Link
                href="/cart"
                prefetch={false}
                onClick={handleCartClick}
                aria-haspopup="dialog"
                aria-label={cartAriaLabel(totalItems, 'Ouvrir le panier')}
                className={`hidden min-h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 lg:inline-flex text-sm font-bold shadow-sm transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:animate-none ${cartPulse ? 'animate-cart-pop' : ''}`}
                style={{ backgroundColor: 'var(--color-primary)', color: onPrimary, outlineColor: 'var(--color-primary)' }}
              >
                <IconShoppingCart size={20} stroke={2} aria-hidden="true" />
                Mon panier
                {totalItems > 0 && (
                  <span aria-hidden="true" className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs font-extrabold tabular-nums" style={{ background: 'var(--color-secondary)', color: onSecondary }}>
                    {formatCartBadge(totalItems)}
                  </span>
                )}
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
