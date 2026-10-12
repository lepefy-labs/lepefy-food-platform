'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CartItem, ProductFulfillmentPolicy } from '@lepefy/types';
import type { ProductFulfillmentResponse } from '@/app/api/products/fulfillment/route';
import { computeCartFulfillment, type CartFulfillmentEligibility } from '@/lib/fulfillment/fulfillmentPolicy';
import { FULFILLMENT_CART_COPY } from '@/lib/storefrontCopy/fulfillmentCopy';

export interface CartFulfillmentState {
  eligibility: CartFulfillmentEligibility;
  /** Modes actuels pas encore lus : ne pas autoriser la suite. */
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Mode de réception du panier, avec les règles produit lues fraîches
 * (`GET /api/products/fulfillment`) : un panier local peut dater d'avant un
 * changement en admin. Même moteur que le serveur (`computeCartFulfillment`) ;
 * en attendant la réponse, la valeur enregistrée dans le panier sert d'aperçu
 * et la suite reste bloquée (jamais « non chargé » pris pour « aucune règle »).
 */
export function useCartFulfillment(items: CartItem[], pickupAvailable: boolean): CartFulfillmentState {
  const idsKey = useMemo(
    () => Array.from(new Set(items.map((item) => item.product.id))).sort().join(','),
    [items],
  );
  const [fresh, setFresh] = useState<{ key: string; policies: Record<string, ProductFulfillmentPolicy> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!idsKey) return;
    const controller = new AbortController();
    setError(null);
    fetch(`/api/products/fulfillment?ids=${encodeURIComponent(idsKey)}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('fulfillment_unavailable');
        const data = await res.json() as Partial<ProductFulfillmentResponse>;
        if (!data.policies || typeof data.policies !== 'object') throw new Error('fulfillment_invalid');
        if (!controller.signal.aborted) setFresh({ key: idsKey, policies: data.policies });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(FULFILLMENT_CART_COPY.checkFailed);
      });
    return () => controller.abort();
  }, [idsKey, revision]);

  const current = fresh?.key === idsKey ? fresh.policies : null;
  const eligibility = useMemo(() => computeCartFulfillment(
    items.map((item) => ({
      id: item.product.id,
      name: item.product.name,
      fulfillment_policy: current?.[item.product.id] ?? item.product.fulfillment_policy,
    })),
    { pickupAvailable },
  ), [current, items, pickupAvailable]);

  return {
    eligibility,
    loading: Boolean(idsKey) && !current && !error,
    error: idsKey ? error : null,
    reload: () => setRevision((value) => value + 1),
  };
}
