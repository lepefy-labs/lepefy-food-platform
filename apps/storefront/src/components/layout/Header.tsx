'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useTenant } from '@/providers/TenantProvider';
import { useCartStore } from '@/stores/cartStore';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';

export function Header() {
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
    openCartDrawer();
  }
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
        <Link href="/" className="font-display font-bold text-xl" style={{ color: 'var(--color-primary)' }}>
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
        <div className="flex items-center gap-4">
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
    </header>
  );
}
