'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { IconArrowRight, IconLoader2 } from '@tabler/icons-react';
import { useCartUiStore } from '@/stores/cartUiStore';
import { useTenant } from '@/providers/TenantProvider';
import { readableOn } from '@/lib/utils/color';
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
  /** Message temporaire posé au-dessus du total (annulation d'un retrait). */
  notice?: ReactNode;
}

const MOBILE_QUERY = '(max-width: 767px)';

/**
 * Barre d'action du panier sur mobile, fixée juste au-dessus de la BottomNav
 * (h-16 + zone sûre iOS/Android) : sous-total en direct, « Livraison et
 * paiement », livraison annoncée pour l'étape suivante (jamais un total final
 * sans elle). Une seule rangée pour rester basse sur les petits écrans. Elle
 * réserve sa hauteur en bas de page (corps du document) pour ne jamais couvrir
 * le dernier article ; la BottomNav garde sa propre réserve (`ShopMain`).
 * Masquée tant que le clavier de la recherche du panier est ouvert.
 */
export function CartCheckoutBar({ subtotal, currency, itemCount, blockedMessage, checking, leaving, onCheckout, notice }: CartCheckoutBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const searching = useCartUiStore((s) => s.cartSearchActive);
  const onPrimary = readableOn(useTenant().primary_color);

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
      data-bottom-chrome
      className={`fixed inset-x-0 z-40 border-t border-black/10 bg-white/95 px-4 py-2 shadow-[0_-8px_24px_rgba(0,0,0,.07)] backdrop-blur motion-reduce:backdrop-blur-none md:hidden ${searching ? 'hidden' : ''}`}
      style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto max-w-xl">
        {notice}
        {visibleMessage && (
          <p id="cart-checkout-blocked" role="status" className="mb-2 rounded-xl bg-amber-50 px-3 py-1.5 text-center text-sm font-semibold leading-snug text-amber-900">
            {visibleMessage}
          </p>
        )}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-700">Sous-total<span className="sr-only"> · {formatProductCount(itemCount)}</span></p>
            <p className="text-xl font-black leading-tight tracking-tight tabular-nums text-gray-950" aria-live="polite" aria-atomic="true">
              {formatPrice(subtotal, currency)}
            </p>
          </div>
          <button
            type="button"
            onClick={onCheckout}
            disabled={disabled}
            aria-disabled={disabled}
            aria-busy={busy || undefined}
            aria-describedby={visibleMessage ? 'cart-checkout-blocked cart-checkout-shipping' : 'cart-checkout-shipping'}
            className="flex min-h-12 max-w-[64%] shrink-0 items-center justify-center gap-1.5 rounded-2xl px-3 py-2 text-center text-sm font-bold min-[360px]:px-4 min-[360px]:text-[15px] leading-tight transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
            style={{ backgroundColor: 'var(--color-primary)', color: onPrimary }}
          >
            {busy
              ? <><IconLoader2 size={18} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> {checking ? 'Vérification…' : ACTION_COPY.processing}</>
              : <>{ACTION_COPY.goToShipping} <IconArrowRight size={18} className="shrink-0 max-[359px]:hidden" aria-hidden="true" /></>}
          </button>
        </div>
        <p id="cart-checkout-shipping" className="mt-1 text-xs leading-snug text-gray-600">Livraison {SUMMARY_COPY.shippingNextStep}</p>
      </div>
    </div>
  );
}
