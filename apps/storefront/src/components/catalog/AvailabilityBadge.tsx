import { IconCircleOff, IconHourglassHigh } from '@tabler/icons-react';
import { AVAILABILITY_COPY, type ProductAvailability } from '@/lib/storefrontCopy/availability';

/**
 * Pastille d'indisponibilité : icône + texte, jamais la couleur seule.
 * Rien n'est rendu pour un produit disponible ou au maximum du panier.
 */
export function AvailabilityBadge({ state, className = '' }: { state: ProductAvailability; className?: string }) {
  if (state === 'sold_out') {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border-[1.5px] border-gray-600 bg-white px-2 py-0.5 text-xs font-bold text-gray-900 ${className}`}>
        <IconCircleOff size={14} aria-hidden="true" className="shrink-0" />{AVAILABILITY_COPY.soldOutBadge}
      </span>
    );
  }
  if (state === 'below_minimum') {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border-[1.5px] border-amber-700 bg-white px-2 py-0.5 text-xs font-bold text-amber-900 ${className}`}>
        <IconHourglassHigh size={14} aria-hidden="true" className="shrink-0" />{AVAILABILITY_COPY.belowMinimumBadge}
      </span>
    );
  }
  return null;
}
