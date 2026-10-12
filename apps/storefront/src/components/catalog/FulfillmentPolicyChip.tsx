import { IconBuildingStore, IconTruck, IconTruckDelivery } from '@tabler/icons-react';
import type { ProductFulfillmentPolicy } from '@lepefy/types';
import { FULFILLMENT_POLICY_LABELS } from '@/lib/storefrontCopy/fulfillmentCopy';

const ICONS = {
  delivery_or_pickup: IconTruckDelivery,
  pickup_only: IconBuildingStore,
  delivery_only: IconTruck,
} as const;

/**
 * Mention compacte du mode de réception (card, ligne de panier). Information
 * produit, jamais une alerte : style neutre, icône + texte.
 */
export function FulfillmentPolicyChip({ policy, className = '' }: { policy: ProductFulfillmentPolicy; className?: string }) {
  const Icon = ICONS[policy];
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-md border border-gray-300 bg-white px-1.5 py-0.5 text-xs font-semibold leading-tight text-gray-800 ${className}`}>
      <Icon size={13} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{FULFILLMENT_POLICY_LABELS[policy]}</span>
    </span>
  );
}
