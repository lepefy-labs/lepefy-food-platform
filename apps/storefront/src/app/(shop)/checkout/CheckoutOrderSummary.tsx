'use client';

import { useState } from 'react';
import { IconGift, IconChevronDown } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import type { CartItem } from '@lepefy/types';
import type { FreeShippingInfo } from '@/lib/shipping/freeShippingInfo';

// Une seule source de vérité pour le récapitulatif (items + calcul des
// totaux, tous reçus en props depuis CheckoutForm.tsx, jamais recalculés
// ici) — seul le markup change selon le breakpoint : bloc statique en haut
// de page en desktop (inchangé), barre compacte `position: sticky` en haut
// sur mobile (repliable inline, pas d'overlay/modale, pas de vh/dvh).

interface CheckoutOrderSummaryProps {
  items:                   CartItem[];
  currency:                string;
  subtotal:                number;
  effectiveShippingTotal:  number;
  shippingRecalculating:   boolean;
  freeShipping:            FreeShippingInfo;
  isPickup:                boolean;
  ambassadorDiscount:      number;
  total:                   number;
  shippingRecalcError:     string | null;
}

function SummaryBody({
  items, currency, subtotal, effectiveShippingTotal, shippingRecalculating,
  freeShipping, isPickup, ambassadorDiscount, total, shippingRecalcError,
}: CheckoutOrderSummaryProps) {
  return (
    <>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.product.id} className="flex justify-between text-sm">
            <span className="text-gray-600 line-clamp-1 mr-2">
              {item.product.name} × {item.quantity}
            </span>
            <span className="font-medium flex-shrink-0">
              {formatPrice(item.product.price * item.quantity, currency)}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-gray-200 mt-3 pt-3 space-y-1.5">
        <div className="flex justify-between text-sm text-gray-500">
          <span>Sous-total</span>
          <span>{formatPrice(subtotal, currency)}</span>
        </div>
        <div className="flex justify-between text-sm text-gray-500">
          <span>Livraison</span>
          <span>
            {shippingRecalculating ? (
              <span className="text-gray-400 text-xs animate-pulse">Recalcul en cours…</span>
            ) : effectiveShippingTotal === 0 ? (
              <span className="text-green-600 font-medium">Gratuit</span>
            ) : (
              formatPrice(effectiveShippingTotal, currency)
            )}
          </span>
        </div>
        {!isPickup && !shippingRecalculating && freeShipping !== null && (
          <div className="flex items-center gap-1.5 text-green-600 text-xs font-medium">
            <IconGift size={14} className="flex-shrink-0" />
            <span>
              {freeShipping.reason === 'threshold'
                ? `🎉 Livraison offerte : votre commande dépasse ${formatPrice(freeShipping.thresholdAmount, currency)}`
                : '🎉 Livraison offerte pour ce pays'}
            </span>
          </div>
        )}
        {ambassadorDiscount > 0 && (
          <div className="flex justify-between text-sm text-green-600 font-medium">
            <span>Réduction parrainage</span>
            <span>−{formatPrice(ambassadorDiscount, currency)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2 mt-1">
          <span>Total</span>
          <span>{formatPrice(total, currency)}</span>
        </div>
        {!isPickup && shippingRecalcError && (
          <p className="text-red-500 text-xs text-right">{shippingRecalcError}</p>
        )}
      </div>
    </>
  );
}

export function CheckoutOrderSummary(props: CheckoutOrderSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      {/* Desktop (md+) : bloc statique en haut de page, comportement inchangé. */}
      <div className="hidden md:block bg-gray-50 rounded-2xl p-4 mb-6">
        <p className="text-sm font-semibold text-gray-700 mb-3">Récapitulatif</p>
        <SummaryBody {...props} />
      </div>

      {/* Mobile (<md) : barre compacte sticky sous le header (lui-même
          sticky top-0 h-16, cf. Header.tsx) — top-16 aligne exactement le
          bas du header, z-30 reste sous le header (z-40) pour ne jamais le
          recouvrir. Flux document normal, pas de vh/dvh, pas d'overlay :
          l'expansion pousse le contenu suivant, ne le recouvre pas. */}
      <div className="md:hidden sticky top-16 z-30 bg-white border-b border-gray-100 mb-6">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between gap-2 py-3"
        >
          <span className="text-sm text-gray-500 flex-shrink-0">Total</span>
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-base font-bold flex-shrink-0" style={{ color: 'var(--color-primary)' }}>
              {formatPrice(props.total, props.currency)}
            </span>
            <span className="flex items-center gap-0.5 text-xs text-gray-500 flex-shrink-0">
              {expanded ? 'Masquer' : 'Voir le détail'}
              <IconChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </span>
          </span>
        </button>
        {expanded && (
          <div className="pb-4">
            <SummaryBody {...props} />
          </div>
        )}
      </div>
    </>
  );
}
