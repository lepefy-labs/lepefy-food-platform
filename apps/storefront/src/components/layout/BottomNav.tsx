'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  IconSmartHome,
  IconCategory,
  IconShoppingCart,
  IconGift,
  IconUserCircle,
  type Icon,
} from '@tabler/icons-react';
import { useHydratedCartCount } from '@/lib/cart/useHydratedCart';
import { useSessionCustomer } from '@/hooks/useSessionCustomer';
import { useTenant } from '@/providers/TenantProvider';
import { cartAriaLabel, formatCartBadge } from '@/lib/cart/cartBadge';
import { useCartAddPulse, useCartNudge } from '@/lib/cart/useCartAttention';
import { readableOn } from '@/lib/utils/color';
import { isCartPath, shouldShowBottomNav } from '@/lib/storefront/shopChrome';
import {
  BOTTOM_NAV_INACTIVE_LABEL,
  bottomNavTint,
  resolveBottomNavPalette,
  type BottomNavDestination,
} from '@/lib/storefront/bottomNavTheme';
import { useCartUiStore } from '@/stores/cartUiStore';

interface Tab {
  destination: BottomNavDestination;
  href: string;
  label: string;
  icon: Icon;
  active: boolean;
}

/**
 * Barre de navigation mobile. Trois fonctions distinctes, jamais mélangées :
 * la couleur reconnaît la destination (`bottomNavTheme.ts`, le panier prend
 * la couleur du tenant), l'état actif oriente (pastille teintée, trait plus
 * épais, libellé gras et coloré, `aria-current`), la pastille du panier dit
 * son contenu. Le panier, toujours repérable (disque plus grand dans la
 * couleur du tenant), n'est actif que sur /cart ; son « pop » ne suit
 * qu'un ajout réel (`useCartAddPulse`, jamais au montage ni à l'hydratation).
 */
export function BottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const goodiesContext = pathname.startsWith('/products/') && searchParams.get('from') === 'gadgets';
  // Panier persisté lu après l'hydratation : premier rendu identique au serveur.
  const totalItems = useHydratedCartCount();
  const { customer } = useSessionCustomer();
  const tenant = useTenant();
  const pulsing = useCartAddPulse();
  const nudging = useCartNudge(pathname);
  // Saisie dans la recherche du panier : le clavier occupe le bas de l'écran.
  const cartSearchActive = useCartUiStore((s) => s.cartSearchActive);
  if (!shouldShowBottomNav(pathname)) return null;
  if (cartSearchActive && isCartPath(pathname)) return null;

  const onSecondary = readableOn(tenant.secondary_color, 4.5);
  const palette = resolveBottomNavPalette(tenant.primary_color);
  const onCartAccent = readableOn(palette.cart);
  const tabs: Tab[] = [
    { destination: 'discover', href: '/accueil', label: 'Découvrir', icon: IconSmartHome, active: pathname === '/accueil' },
    {
      destination: 'catalog', href: '/', label: 'Catalogue', icon: IconCategory,
      active: pathname === '/' || (pathname.startsWith('/products/') && !goodiesContext),
    },
    { destination: 'cart', href: '/cart', label: 'Panier', icon: IconShoppingCart, active: isCartPath(pathname) },
    {
      destination: 'goodies', href: '/gadgets', label: 'Goodies', icon: IconGift,
      active: pathname === '/gadgets' || pathname.startsWith('/gadgets/') || goodiesContext,
    },
    {
      destination: 'account', href: '/compte/connexion', label: 'Compte', icon: IconUserCircle,
      active: pathname === '/compte' || pathname.startsWith('/compte/'),
    },
  ];

  function renderTab({ destination, href, label, icon: TabIcon, active }: Tab) {
    const accent = palette[destination];
    const isCart = destination === 'cart';
    const animation = pulsing ? 'animate-cart-pop' : nudging ? 'animate-cart-nudge' : '';
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? 'page' : undefined}
        aria-label={isCart ? cartAriaLabel(totalItems) : undefined}
        data-destination={destination}
        // Libellés alignés en bas : le disque du panier dépasse vers le haut, jamais hors de la barre.
        className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-0.5 pb-1.5 focus-visible:outline-none"
      >
        {isCart ? (
          // Panier toujours repérable : disque de 44 px dans la couleur du tenant, plus haut
          // que les autres pastilles mais contenu dans la barre (rien sur la barre d'achat
          // d'une fiche produit). Teinté hors du panier, plein sur le panier (état actif).
          <span
            className="relative flex h-11 w-11 items-center justify-center rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-offset-2 motion-reduce:transition-none"
            style={{
              ['--tw-ring-color' as string]: accent,
              ...(active
                ? { backgroundColor: accent, color: onCartAccent, boxShadow: `0 0 0 2px #fff, 0 0 0 4px ${accent}` }
                : { backgroundColor: bottomNavTint(accent), color: accent, boxShadow: `inset 0 0 0 1.5px ${accent}, 0 3px 8px color-mix(in srgb, ${accent} 28%, transparent)` }),
            }}
          >
            <span className={`relative flex motion-reduce:animate-none ${animation}`}>
              <TabIcon size={26} stroke={active ? 2.25 : 2} aria-hidden="true" />
              {totalItems > 0 && (
                <span aria-hidden="true"
                  className="absolute -right-3.5 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs font-extrabold tabular-nums ring-2 ring-white"
                  style={{ background: 'var(--color-secondary)', color: onSecondary }}>
                  {formatCartBadge(totalItems)}
                </span>
              )}
            </span>
          </span>
        ) : (
          /* Pastille de même taille dans tous les états : aucun décalage quand elle se teinte. */
          <span
            className="relative flex h-8 w-14 items-center justify-center rounded-full transition-colors group-focus-visible:ring-2 group-focus-visible:ring-offset-1 motion-reduce:transition-none"
            style={{ backgroundColor: active ? bottomNavTint(accent) : 'transparent', color: accent, ['--tw-ring-color' as string]: accent }}
          >
            <span className="relative flex">
              <TabIcon size={24} stroke={active ? 2.25 : 1.75} aria-hidden="true" />
              {destination === 'account' && customer && (
                <span aria-hidden="true" className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full ring-2 ring-white" style={{ backgroundColor: accent }} />
              )}
            </span>
          </span>
        )}
        <span
          className={`max-w-full truncate text-xs leading-none ${active ? 'font-bold' : 'font-medium'}`}
          style={{ color: active ? accent : BOTTOM_NAV_INACTIVE_LABEL }}
        >
          {label}
        </span>
      </Link>
    );
  }

  return (
    <nav aria-label="Navigation boutique" data-bottom-chrome className="fixed bottom-0 left-0 right-0 z-50 w-full border-t border-gray-100 bg-white shadow-[0_-2px_10px_rgba(0,0,0,0.08)] md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex h-16 items-stretch">
        {tabs.map(renderTab)}
      </div>
    </nav>
  );
}
