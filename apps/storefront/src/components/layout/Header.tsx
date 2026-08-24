'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { IconArrowLeft, IconLock, IconMenu2, IconShoppingCart, IconX } from '@tabler/icons-react';
import { useTenant } from '@/providers/TenantProvider';
import { useCartStore } from '@/stores/cartStore';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const tenant = useTenant();
  const totalItems = useCartStore((s) => s.totalItems());
  const openCartDrawer = useCartUiStore((s) => s.openDrawer);
  const { customer } = useSessionCustomer();
  const isCheckout = pathname === '/checkout' || pathname.startsWith('/checkout/');

  function handleCartClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setMobileMenuOpen(false);
    openCartDrawer();
  }

  if (isCheckout) {
    return (
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur">
        <div className="relative mx-auto flex h-16 max-w-2xl items-center justify-between px-4 sm:px-6">
          <Link href="/cart" aria-label="Retour au panier" className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
            <IconArrowLeft size={22} />
          </Link>
          <Link href="/" className="absolute left-1/2 -translate-x-1/2" aria-label={tenant.name}>
            {tenant.logo_url ? (
              <span className="relative block h-11 w-[116px] max-w-[36vw]">
                <Image src={tenant.logo_url} alt={tenant.name} fill sizes="116px" className="object-contain" priority />
              </span>
            ) : (
              <span className="font-display text-lg font-bold" style={{ color: 'var(--color-primary)' }}>{tenant.name}</span>
            )}
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
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
      <div className="relative mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <button
          type="button"
          onClick={() => setMobileMenuOpen((open) => !open)}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-shop-menu"
          aria-label={mobileMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          className="absolute left-4 flex h-11 w-11 items-center justify-center rounded-lg text-gray-700 focus-visible:outline-none focus-visible:ring-2 md:hidden"
        >
          {mobileMenuOpen ? <IconX size={24} /> : <IconMenu2 size={24} />}
        </button>

        <Link href="/" className="absolute left-1/2 -translate-x-1/2 font-display text-xl font-bold md:static md:translate-x-0" style={{ color: 'var(--color-primary)' }}>
          {tenant.logo_url ? (
            <span className="relative block h-12 w-[140px] max-w-[40vw] md:h-11 md:w-[120px]">
              <Image src={tenant.logo_url} alt={tenant.name} fill sizes="(max-width: 767px) 140px, 120px" className="object-contain" priority />
            </span>
          ) : tenant.name}
        </Link>
        <div className="ml-auto flex items-center gap-4">
          <Link
            href="/cart"
            onClick={handleCartClick}
            aria-haspopup="dialog"
            aria-label={`Ouvrir le panier${totalItems > 0 ? `, ${totalItems} article${totalItems > 1 ? 's' : ''}` : ''}`}
            className="absolute right-4 flex h-11 w-11 items-center justify-center rounded-lg text-gray-700 focus-visible:outline-none focus-visible:ring-2 md:hidden"
          >
            <IconShoppingCart size={24} />
            {totalItems > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-0.5 text-2xs font-bold" style={{ background: 'var(--color-secondary)', color: '#1a1a1a' }}>
                {totalItems > 99 ? '99+' : totalItems}
              </span>
            )}
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            <Link href="/products" className="text-sm font-medium text-gray-700 hover:text-gray-900">Catalogue</Link>
            <Link href="/cart" onClick={handleCartClick} aria-haspopup="dialog" className="relative text-sm font-medium text-gray-700 hover:text-gray-900">
              Panier
              {totalItems > 0 && <span className="absolute -right-4 -top-2 flex h-5 w-5 items-center justify-center rounded-full text-xs text-white" style={{ backgroundColor: 'var(--color-primary)' }}>{totalItems}</span>}
            </Link>
            <Link href="/compte/connexion" className="relative text-sm font-medium text-gray-700 hover:text-gray-900">
              Compte
              {customer && <span className="absolute -right-2.5 -top-1 h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />}
            </Link>
          </nav>
        </div>
      </div>

      {mobileMenuOpen && (
        <nav id="mobile-shop-menu" className="absolute inset-x-0 top-16 border-b border-gray-200 bg-white px-4 py-3 shadow-lg md:hidden" aria-label="Navigation principale mobile">
          <div className="mx-auto grid max-w-7xl gap-1">
            {([
              ['Accueil', '/'], ['Catalogue', '/products'], ['Panier', '/cart'], ['Commandes', '/orders'], ['Compte', '/compte/connexion'],
            ] as const).map(([label, href]) => (
              <Link key={href} href={href} onClick={() => setMobileMenuOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2">{label}</Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
