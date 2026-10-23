'use client';

import { useId } from 'react';
import { IconTruckDelivery } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { countryLabel } from '@/lib/address/addressRules';
import { formatHeadroom } from '@/lib/shipping/tariff/shippingEstimate';
import type { CartShippingEstimate as Estimate } from '@/lib/cart/useShippingEstimate';
import { SUMMARY_COPY } from '@/lib/storefrontCopy/copy';

/**
 * Estimation du forfait au panier. Jamais la grille ni les bornes des
 * tranches : le pays, le prix estimé, la marge arrondie (« encore 2,8 kg sans
 * frais de livraison en plus ») ou le reste pour la livraison offerte. Sans
 * estimation : le texte d'avant (« calculée à l'étape suivante »).
 */
export function shippingEstimateParts(estimate: Estimate | null, currency: string) {
  if (!estimate) return null;
  const country = countryLabel(estimate.country);
  const price = estimate.freeShipping ? 'Offerte' : formatPrice(estimate.finalCents / 100, currency);
  const nudge = estimate.freeShipping ? null
    : estimate.freeShippingRemainingCents !== null ? `Plus que ${formatPrice(estimate.freeShippingRemainingCents / 100, currency)} pour la livraison offerte`
      : estimate.headroomG !== null ? `Encore ${formatHeadroom(estimate.headroomG)} sans frais de livraison en plus`
        : null;
  const surcharge = estimate.zoneSurcharge
    ? `Hors supplément de certaines zones (+${formatPrice(estimate.zoneSurcharge.amountCents / 100, currency)}${estimate.zoneSurcharge.perParcel ? ' par colis' : ''}).`
    : null;
  return { country, price, nudge, surcharge, estimated: !estimate.exact };
}

/** Ligne compacte de la barre mobile (sous le sous-total). */
export function CartShippingEstimateCompact({ estimate, currency, id }: { estimate: Estimate | null; currency: string; id?: string }) {
  const parts = shippingEstimateParts(estimate, currency);
  if (!parts) return <p id={id} className="mt-1 text-xs leading-snug text-gray-600">Livraison {SUMMARY_COPY.shippingNextStep}</p>;
  return (
    <p id={id} className="mt-1 text-xs leading-snug text-gray-700" aria-live="polite">
      Livraison {parts.estimated ? 'estimée ' : ''}({parts.country}) : <span className="font-semibold text-gray-900">{parts.price}</span>
      {parts.nudge && <><span aria-hidden="true"> · </span><span className="font-semibold text-emerald-800">{parts.nudge}</span></>}
    </p>
  );
}

/** Bloc du récapitulatif tablette / desktop, avec « Changer » quand plusieurs pays sont servis. */
export function CartShippingEstimateDetail({ estimate, currency, onChooseCountry }: {
  estimate: Estimate | null;
  currency: string;
  onChooseCountry: (country: string) => void;
}) {
  const selectId = useId();
  const parts = shippingEstimateParts(estimate, currency);
  if (!estimate || !parts) {
    return (
      <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
        <span className="text-gray-700">Livraison</span>
        <span className="text-gray-800">{SUMMARY_COPY.shippingNextStep}</span>
      </div>
    );
  }
  const several = estimate.countries.length > 1 && estimate.source !== 'address';
  return (
    <div className="space-y-1.5 py-1 text-sm" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-gray-700">Livraison {parts.estimated ? 'estimée' : ''} ({parts.country})</span>
        <span className="font-semibold text-gray-900">{parts.price}</span>
      </div>
      {several && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <label htmlFor={selectId} className="text-gray-600">Livrer en</label>
          <select id={selectId} value={estimate.country} onChange={(event) => onChooseCountry(event.target.value)}
            className="min-h-9 rounded-lg border border-gray-300 bg-white px-2 text-xs text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
            {estimate.countries.map((code) => <option key={code} value={code}>{countryLabel(code)}</option>)}
          </select>
        </div>
      )}
      {parts.nudge && (
        <p className="flex items-start gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold leading-snug text-emerald-900">
          <IconTruckDelivery size={15} aria-hidden="true" className="mt-px shrink-0" />{parts.nudge}
        </p>
      )}
      {parts.surcharge && <p className="text-xs leading-snug text-gray-600">{parts.surcharge}</p>}
    </div>
  );
}
