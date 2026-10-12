import { forwardRef } from 'react';
import { IconAlertTriangle, IconBuildingStore, IconTruck } from '@tabler/icons-react';
import type { CartFulfillmentEligibility } from '@/lib/fulfillment/fulfillmentPolicy';
import { FULFILLMENT_CART_COPY } from '@/lib/storefrontCopy/fulfillmentCopy';

interface Props {
  eligibility: CartFulfillmentEligibility;
  /** Retrait proposé par la boutique : sans lui, « livraison imposée » n'apprend rien au client. */
  pickupAvailable: boolean;
  className?: string;
}

/**
 * Mode de réception imposé par le panier (panier et checkout). Un mode imposé
 * est une information ; un panier incompatible ou un retrait impossible
 * bloque la suite et nomme les produits en cause.
 */
export const CartFulfillmentNotice = forwardRef<HTMLDivElement, Props>(function CartFulfillmentNotice(
  { eligibility, pickupAvailable, className = '' },
  ref,
) {
  const { status, pickupOnlyProducts, deliveryOnlyProducts } = eligibility;

  if (status === 'conflict' || status === 'pickup_unavailable') {
    return (
      <div ref={ref} tabIndex={-1} role="alert" data-fulfillment-notice={status}
        className={`rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3.5 text-sm text-amber-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${className}`}>
        <p className="flex items-start gap-2 font-bold">
          <IconAlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          {status === 'conflict' ? FULFILLMENT_CART_COPY.conflictTitle : FULFILLMENT_CART_COPY.pickupUnavailableTitle}
        </p>
        {status === 'conflict' ? (
          <>
            <ul className="mt-1.5 space-y-1 pl-6">
              <li className="flex items-start gap-1.5"><IconBuildingStore size={15} className="mt-0.5 shrink-0" aria-hidden="true" />{FULFILLMENT_CART_COPY.conflictPickupList(pickupOnlyProducts)}</li>
              <li className="flex items-start gap-1.5"><IconTruck size={15} className="mt-0.5 shrink-0" aria-hidden="true" />{FULFILLMENT_CART_COPY.conflictDeliveryList(deliveryOnlyProducts)}</li>
            </ul>
            <p className="mt-1.5 pl-6 font-semibold">{FULFILLMENT_CART_COPY.conflictAction}</p>
          </>
        ) : (
          <p className="mt-1 pl-6">{FULFILLMENT_CART_COPY.pickupUnavailableDetail(pickupOnlyProducts)}</p>
        )}
      </div>
    );
  }

  if (status === 'pickup_forced' || (status === 'delivery_forced' && pickupAvailable)) {
    const pickup = status === 'pickup_forced';
    const Icon = pickup ? IconBuildingStore : IconTruck;
    return (
      <div ref={ref} role="status" data-fulfillment-notice={status}
        className={`rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3.5 text-sm text-blue-950 ${className}`}>
        <p className="flex items-start gap-2 font-bold">
          <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          {pickup ? FULFILLMENT_CART_COPY.pickupForcedTitle : FULFILLMENT_CART_COPY.deliveryForcedTitle}
        </p>
        <p className="mt-1 pl-6">
          {pickup ? FULFILLMENT_CART_COPY.pickupForcedDetail(pickupOnlyProducts) : FULFILLMENT_CART_COPY.deliveryForcedDetail(deliveryOnlyProducts)}
        </p>
      </div>
    );
  }

  return null;
});
