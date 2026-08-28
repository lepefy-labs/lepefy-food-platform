'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  IconArrowLeft,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandTiktok,
  IconBrandX,
  IconBrandYoutube,
  IconCalendarEvent,
  IconCategory,
  IconChevronRight,
  IconCreditCard,
  IconHome,
  IconLock,
  IconMapPin,
  IconMenu2,
  IconMessageCircle,
  IconShoppingCart,
  IconTools,
  IconTruckDelivery,
  IconUserCircle,
  IconX,
} from '@tabler/icons-react';
import { useTenant } from '@/providers/TenantProvider';
import { useCartStore } from '@/stores/cartStore';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import { TenantLogo } from '@/components/branding/TenantLogo';
import { SOCIAL_PLATFORM_REGISTRY, type TenantSocialLink } from '@lepefy/types';

const SOCIAL_ICONS = {
  IconBrandInstagram,
  IconBrandFacebook,
  IconBrandTiktok,
  IconBrandYoutube,
  IconBrandLinkedin,
  IconBrandX,
};

interface HeaderProps {
  socialLinks?: TenantSocialLink[];
  storyEnabled?: boolean;
}

interface DrawerLinkProps {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  onNavigate: () => void;
  external?: boolean;
}

function DrawerLink({ href, label, icon, active, onNavigate, external = false }: DrawerLinkProps) {
  const classes = `group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
    active ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]' : 'text-gray-700 hover:bg-gray-50 hover:text-gray-950'
  }`;

  const content = (
    <>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-white/80' : 'bg-gray-100 text-gray-600 group-hover:bg-white'}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
      <IconChevronRight size={17} className="shrink-0 text-gray-400" />
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={onNavigate} className={classes}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} onClick={onNavigate} className={classes} aria-current={active ? 'page' : undefined}>
      {content}
    </Link>
  );
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

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  function handleCartClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setMenuOpen(false);
    openCartDrawer();
  }

  function isActive(href: string) {
    if (href === '/') return pathname === '/' || pathname.startsWith('/products/');
    if (href === '/accueil') return pathname === '/accueil';
    if (href.startsWith('/evenementiel')) return pathname.startsWith('/evenementiel');
    if (href === '/orders') return pathname === '/orders' || pathname.startsWith('/orders/');
    if (href.startsWith('/compte')) return pathname === '/compte' || pathname.startsWith('/compte/');
    return pathname === href;
  }

  const whatsappHref = tenant.whatsapp_number
    ? `https://wa.me/${tenant.whatsapp_number.replace(/\D/g, '')}`
    : null;

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

      <div
        className={`fixed inset-0 z-[70] transition ${menuOpen ? 'pointer-events-auto bg-black/35 opacity-100' : 'pointer-events-none bg-black/0 opacity-0'}`}
        aria-hidden={!menuOpen}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setMenuOpen(false);
        }}
      >
        <aside
          id="storefront-navigation-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Menu de navigation"
          className={`absolute inset-y-0 left-0 flex w-[86vw] max-w-[360px] flex-col bg-white shadow-2xl transition-transform duration-200 ease-out md:left-auto md:right-0 md:w-[380px] md:max-w-[380px] ${menuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-full'}`}
        >
          <div className="flex items-start gap-3 border-b border-gray-100 px-4 py-4">
            <div className="min-w-0 flex-1">
              <TenantLogo variant="compact" className="h-11 w-[150px] max-w-[55vw]" />
              {tenant.tagline && <p className="mt-1.5 line-clamp-2 max-w-[30ch] text-xs leading-relaxed text-gray-500">{tenant.tagline}</p>}
            </div>
            <button type="button" onClick={() => setMenuOpen(false)} aria-label="Fermer le menu" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
              <IconX size={22} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4">
            <section aria-labelledby="drawer-explorer-title">
              <p id="drawer-explorer-title" className="px-3 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-gray-400">Explorer</p>
              <div className="space-y-1">
                <DrawerLink href="/accueil" label="Découvrir" icon={<IconHome size={19} />} active={isActive('/accueil')} onNavigate={() => setMenuOpen(false)} />
                <DrawerLink href="/" label="Catalogue" icon={<IconCategory size={19} />} active={isActive('/')} onNavigate={() => setMenuOpen(false)} />
              </div>
            </section>

            {(tenant.events_enabled || tenant.services_enabled || tenant.google_maps_url) && (
              <section aria-labelledby="drawer-services-title" className="mt-5 border-t border-gray-100 pt-4">
                <p id="drawer-services-title" className="px-3 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-gray-400">Nos services</p>
                <div className="space-y-1">
                  {tenant.events_enabled && <DrawerLink href="/evenementiel#evenements" label="Événements" icon={<IconCalendarEvent size={19} />} active={isActive('/evenementiel')} onNavigate={() => setMenuOpen(false)} />}
                  {tenant.services_enabled && <DrawerLink href="/evenementiel#services" label="Traiteur & location" icon={<IconTools size={19} />} active={isActive('/evenementiel')} onNavigate={() => setMenuOpen(false)} />}
                  <DrawerLink href="/card" label="Carte & paiement" icon={<IconCreditCard size={19} />} active={pathname.startsWith('/card')} onNavigate={() => setMenuOpen(false)} />
                  {tenant.google_maps_url && <DrawerLink href={tenant.google_maps_url} label="Nous trouver" icon={<IconMapPin size={19} />} active={false} external onNavigate={() => setMenuOpen(false)} />}
                </div>
              </section>
            )}

            <section aria-labelledby="drawer-account-title" className="mt-5 border-t border-gray-100 pt-4">
              <p id="drawer-account-title" className="px-3 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-gray-400">Votre espace</p>
              <div className="mb-2 rounded-2xl bg-gray-50 px-3 py-3">
                <p className="text-sm font-bold text-gray-900">{customer ? 'Votre compte client' : 'Retrouvez vos achats'}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{customer ? 'Commandes, profil et avantages au même endroit.' : 'Connectez-vous pour suivre vos commandes et votre compte.'}</p>
              </div>
              <div className="space-y-1">
                <DrawerLink href="/orders" label="Mes commandes" icon={<IconTruckDelivery size={19} />} active={isActive('/orders')} onNavigate={() => setMenuOpen(false)} />
                <DrawerLink href={accountHref} label={customer ? 'Mon compte' : 'Se connecter'} icon={<IconUserCircle size={19} />} active={isActive('/compte')} onNavigate={() => setMenuOpen(false)} />
              </div>
            </section>

            {(storyEnabled || whatsappHref || socialLinks.length > 0) && (
              <section aria-labelledby="drawer-brand-title" className="mt-5 border-t border-gray-100 pt-4">
                <p id="drawer-brand-title" className="px-3 pb-1.5 text-[10px] font-extrabold uppercase tracking-[0.16em] text-gray-400">{tenant.name}</p>
                <div className="space-y-1">
                  {storyEnabled && <DrawerLink href="/accueil#origine" label="Notre histoire" icon={<IconHome size={19} />} active={false} onNavigate={() => setMenuOpen(false)} />}
                  {whatsappHref && <DrawerLink href={whatsappHref} label="Nous contacter" icon={<IconMessageCircle size={19} />} active={false} external onNavigate={() => setMenuOpen(false)} />}
                </div>
                {socialLinks.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 px-3" aria-label="Réseaux sociaux">
                    {socialLinks.map((link) => {
                      const meta = SOCIAL_PLATFORM_REGISTRY[link.platform];
                      const SocialIcon = SOCIAL_ICONS[meta.iconName];
                      return (
                        <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={meta.label} onClick={() => setMenuOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]" style={{ background: meta.badgeBackground }}>
                          <SocialIcon size={18} stroke={1.6} className="text-white" />
                        </a>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </div>

          <div className="border-t border-gray-100 px-4 py-3 text-[11px] text-gray-400" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <Link href="/politique-confidentialite" onClick={() => setMenuOpen(false)} className="hover:text-gray-600">Confidentialité</Link>
              <Link href="/conditions-generales-vente" onClick={() => setMenuOpen(false)} className="hover:text-gray-600">CGV</Link>
            </div>
            {tenant.show_powered_by && <p className="mt-1.5">Propulsé par <span className="font-semibold text-gray-500">Lepefy Labs</span></p>}
          </div>
        </aside>
      </div>
    </>
  );
}
