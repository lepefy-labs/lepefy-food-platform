'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconShoppingCart } from '@tabler/icons-react';
import { useHydratedCartCount } from '@/lib/cart/useHydratedCart';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useTenant } from '@/providers/TenantProvider';
import { cartAriaLabel, formatCartBadge } from '@/lib/cart/cartBadge';
import { useCartAddPulse } from '@/lib/cart/useCartAttention';
import { readableOn } from '@/lib/utils/color';

/**
 * Accès au panier latéral collé au champ de recherche (barre mobile fixe),
 * comme l'accès « livraison » à côté de la recherche d'Amazon : toujours
 * visible au défilement. Ouvre le drawer ; `/cart` reste le lien de repli
 * (clic molette, nouvel onglet, JS indisponible) et la destination sur /cart.
 */
export function CartShortcutButton({ className = '' }: { className?: string }) {
  const pathname = usePathname();
  const tenant = useTenant();
  const totalItems = useHydratedCartCount();
  const openDrawer = useCartUiStore((s) => s.openDrawer);
  const pulsing = useCartAddPulse();
  const onCartPage = pathname === '/cart';

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (onCartPage || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openDrawer();
  }

  return (
    <Link
      href="/cart"
      // Visible sur toutes les pages mobiles et ouvre le panier latéral : pas de prefetch de /cart (dynamique).
      prefetch={false}
      onClick={handleClick}
      aria-haspopup={onCartPage ? undefined : 'dialog'}
      aria-current={onCartPage ? 'page' : undefined}
      aria-label={cartAriaLabel(totalItems, onCartPage ? 'Panier' : 'Ouvrir le panier')}
      className={`relative flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:animate-none ${pulsing ? 'animate-cart-pop' : ''} ${className}`}
      style={{ backgroundColor: 'var(--color-primary)', color: readableOn(tenant.primary_color), outlineColor: 'var(--color-primary)' }}
    >
      <IconShoppingCart size={26} stroke={2} aria-hidden="true" />
      {totalItems > 0 && (
        <span aria-hidden="true"
          className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs font-extrabold tabular-nums ring-2 ring-white"
          style={{ background: 'var(--color-secondary)', color: readableOn(tenant.secondary_color, 4.5) }}>
          {formatCartBadge(totalItems)}
        </span>
      )}
    </Link>
  );
}
