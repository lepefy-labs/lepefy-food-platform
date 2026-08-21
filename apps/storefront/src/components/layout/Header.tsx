'use client';
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { IconMenu2, IconShoppingCart, IconX } from '@tabler/icons-react';
import { useTenant } from '@/providers/TenantProvider';
import { useCartStore } from '@/stores/cartStore';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const tenant = useTenant();
  const totalItems = useCartStore((s) => s.totalItems());
  const openCartDrawer = useCartUiStore((s) => s.openDrawer);
  const { customer } = useSessionCustomer();

  // Ouvre le drawer au clic simple ; laisse le navigateur gérer le
  // comportement natif (nouvel onglet, etc.) pour un clic modifié/molette —
  // href="/cart" reste donc la cible réelle du lien, jamais un <button>.
  function handleCartClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setMobileMenuOpen(false);
    openCartDrawer();
  }
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="relative max-w-7xl mx-auto px-4 h-16 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(open => !open)}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-shop-menu"
          aria-label={mobileMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          className="md:hidden absolute left-4 flex h-11 w-11 items-center justify-center rounded-lg text-gray-700 focus-visible:outline-none focus-visible:ring-2"
        >
          {mobileMenuOpen ? <IconX size={24} /> : <IconMenu2 size={24} />}
        </button>

        <Link href="/" className="absolute left-1/2 -translate-x-1/2 font-display font-bold text-xl md:static md:translate-x-0" style={{ color: 'var(--color-primary)' }}>
          {tenant.logo_url ? (
            <Image
              src={tenant.logo_url}
              alt={tenant.name}
              width={120}
              height={48}
              className="h-11 w-auto max-w-[120px] object-contain object-left"
              priority
            />
          ) : tenant.name}
        </Link>
        <div className="ml-auto flex items-center gap-4">
          <Link
            href="/cart"
            onClick={handleCartClick}
            aria-haspopup="dialog"
            aria-label={`Ouvrir le panier${totalItems > 0 ? `, ${totalItems} article${totalItems > 1 ? 's' : ''}` : ''}`}
            className="md:hidden absolute right-4 flex h-11 w-11 items-center justify-center rounded-lg text-gray-700 focus-visible:outline-none focus-visible:ring-2"
          >
            <IconShoppingCart size={24} />
            {totalItems > 0 && (
              <span className="absolute right-0.5 top-0.5 min-w-[16px] h-4 px-0.5 rounded-full text-2xs font-bold flex items-center justify-center" style={{ background: 'var(--color-secondary)', color: '#1a1a1a' }}>
                {totalItems > 99 ? '99+' : totalItems}
              </span>
            )}
          </Link>

          {/* Nav desktop — hidden on mobile, bottom bar handles navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <Link href="/products" className="text-sm font-medium text-gray-700 hover:text-gray-900">Catalogue</Link>
            <Link
              href="/cart"
              onClick={handleCartClick}
              aria-haspopup="dialog"
              className="relative text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              Panier
              {totalItems > 0 && (
                <span className="absolute -top-2 -right-4 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary)' }}>
                  {totalItems}
                </span>
              )}
            </Link>
            <Link href="/compte/connexion" className="relative text-sm font-medium text-gray-700 hover:text-gray-900">
              Compte
              {customer && (
                <span
                  className="absolute -top-1 -right-2.5 h-2 w-2 rounded-full"
                  style={{ backgroundColor: 'var(--color-primary)' }}
                />
              )}
            </Link>
          </nav>
        </div>
      </div>

      {mobileMenuOpen && (
        <nav id="mobile-shop-menu" className="md:hidden absolute inset-x-0 top-16 border-b border-gray-200 bg-white px-4 py-3 shadow-lg" aria-label="Navigation principale mobile">
          <div className="mx-auto grid max-w-7xl gap-1">
            {([
              ['Accueil', '/'],
              ['Catalogue', '/products'],
              ['Panier', '/cart'],
              ['Commandes', '/orders'],
              ['Compte', '/compte/connexion'],
            ] as const).map(([label, href]) => (
              <Link key={href} href={href} onClick={() => setMobileMenuOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2">
                {label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
