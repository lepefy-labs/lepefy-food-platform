import Link from 'next/link';
import { formatPrice } from '@/lib/utils/format';
import { FreeShippingProgress } from './FreeShippingProgress';
import type { CartSyncStatus } from '@/lib/cart/cartTypes';

interface CartDrawerFooterProps {
  subtotal: number;
  currency?: string;
  syncStatus: CartSyncStatus;
  onNavigateToCart: () => void;
  onContinueShopping: () => void;
}

// Bannière sync — quasi invisible par design (§10). 'syncing'/'idle'/'synced'/
// 'conflict' ne produisent jamais de message : un conflict est toujours
// réconcilié + retenté automatiquement par cartSyncEngine (cf. v3.58), il ne
// devient visible ici que s'il finit en 'error' après épuisement des
// tentatives — donc seul 'error' (definitivo) et 'offline' remontent à
// l'utilisateur, jamais l'état interne "conflict" transitoire.
function SyncBanner({ status }: { status: CartSyncStatus }) {
  if (status === 'offline') {
    return (
      <p className="text-xs text-gray-400 text-center" role="status">
        Modifications enregistrées sur cet appareil.
      </p>
    );
  }
  if (status === 'error') {
    return (
      <p className="text-xs text-amber-600 text-center" role="status">
        Impossible de synchroniser le panier. Nous réessaierons automatiquement.
      </p>
    );
  }
  return null;
}

export function CartDrawerFooter({
  subtotal,
  currency,
  syncStatus,
  onNavigateToCart,
  onContinueShopping,
}: CartDrawerFooterProps) {
  return (
    <div className="border-t border-gray-100 px-5 py-4 shrink-0 space-y-3">
      <div className="flex justify-between items-center text-sm">
        <span className="text-gray-500">Sous-total</span>
        <span className="font-bold text-base">{formatPrice(subtotal, currency)}</span>
      </div>

      <FreeShippingProgress subtotal={subtotal} threshold={null} currency={currency} />

      <Link
        href="/cart"
        onClick={onNavigateToCart}
        className="block w-full text-center py-3.5 rounded-2xl font-bold text-white text-sm transition-opacity active:opacity-90"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        Voir mon panier
      </Link>

      <button
        type="button"
        onClick={onContinueShopping}
        className="block w-full text-center py-1 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
      >
        Continuer mes achats
      </button>

      <div aria-live="polite">
        <SyncBanner status={syncStatus} />
      </div>
    </div>
  );
}
