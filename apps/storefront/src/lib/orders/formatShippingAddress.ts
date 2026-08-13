import type { ShippingAddress } from '@lepefy/types';

/**
 * Formatte un ShippingAddress en une seule ligne lisible pour email/notification.
 * Retourne null si l'adresse est absente (ex. commandes Click & Collect, où
 * shipping_address est toujours null).
 */
export function formatShippingAddress(address: ShippingAddress | null | undefined): string | null {
  if (!address) return null;

  const parts = [
    address.line1,
    address.line2,
    [address.postal_code, address.city].filter(Boolean).join(' '),
    address.country,
  ].filter((p): p is string => Boolean(p && p.trim() !== ''));

  return parts.length > 0 ? parts.join(', ') : null;
}
