'use client';

import { useEffect, useRef } from 'react';
import { IconArrowRight, IconLoader2, IconLock } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { formatProductCount } from '@/lib/cart/formatProductCount';
import { ACTION_COPY, SUMMARY_COPY } from '@/lib/storefrontCopy/copy';

interface CartCheckoutBarProps {
  subtotal: number;
  currency?: string;
  itemCount: number;
  /** Raison du blocage (minimum, stock, mode de réception) ; null = la suite est permise. */
  blockedMessage: string | null;
  /** Règles du panier en cours de vérification. */
  checking: boolean;
  /** Navigation vers /checkout déjà lancée : un seul envoi. */
  leaving: boolean;
  onCheckout: () => void;
}

const MOBILE_QUERY = '(max-width: 767px)';

/**
 * Barre d'action du panier sur mobile, fixée en bas d'écran : sous-total en
 * direct, « Livraison et paiement », livraison annoncée pour l'étape suivante
 * (jamais un total final sans elle). La BottomNav est masquée sur le panier
 * (`shouldShowBottomNav`) : c'est la seule zone du bas. Elle réserve sa propre
 * hauteur en bas de page (corps du document) pour ne jamais couvrir le dernier
 * article ni le pied de page, et respecte la zone sûre iOS/Android.
 */
export function CartCheckoutBar({ subtotal, currency, itemCount, blockedMessage, checking, leaving, onCheckout }: CartCheckoutBarProps) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const media = window.matchMedia(MOBILE_QUERY);
    const body = document.body;
    const previous = body.style.paddingBottom;
    function reserve() {
      body.style.paddingBottom = media.matches && bar ? `${bar.offsetHeight}px` : previous;
    }
    const observer = new ResizeObserver(reserve);
    observer.observe(bar);
    media.addEventListener('change', reserve);
    reserve();
    return () => {
      observer.disconnect();
      media.removeEventListener('change', reserve);
      body.style.paddingBottom = previous;
    };
  }, []);

  const busy = checking || leaving;
  const disabled = busy || Boolean(blockedMessage);
  // Le message « Vérification… » du gate est remplacé par l'état du bouton.
  const visibleMessage = checking ? null : blockedMessage;

  return (
    <div
      ref={barRef}
      data-testid="cart-checkout-bar"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/95 px-4 pt-3 shadow-[0_-10px_30px_rgba(0,0,0,.08)] backdrop-blur motion-reduce:backdrop-blur-none md:hidden"
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto max-w-xl">
        {visibleMessage && (
          <p id="cart-checkout-blocked" role="status" className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-center text-sm font-semibold leading-snug text-amber-900">
            {visibleMessage}
          </p>
        )}
        <div className="mb-2 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-700">Sous-total · {formatProductCount(itemCount)}</p>
            <p className="text-2xl font-black leading-tight tracking-tight tabular-nums text-gray-950" aria-live="polite" aria-atomic="true">
              {formatPrice(subtotal, currency)}
            </p>
          </div>
          <p className="max-w-[46%] text-right text-xs leading-snug text-gray-700">
            Livraison {SUMMARY_COPY.shippingNextStep}
            <span className="mt-0.5 flex items-center justify-end gap-1 font-semibold text-green-800"><IconLock size={12} aria-hidden="true" /> Paiement sécurisé</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onCheckout}
          disabled={disabled}
          aria-disabled={disabled}
          aria-busy={busy || undefined}
          aria-describedby={visibleMessage ? 'cart-checkout-blocked' : undefined}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-base font-bold text-white transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {busy
            ? <><IconLoader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {checking ? 'Vérification du panier…' : ACTION_COPY.processing}</>
            : <>{ACTION_COPY.goToShipping} <IconArrowRight size={18} aria-hidden="true" /></>}
        </button>
      </div>
    </div>
  );
}
