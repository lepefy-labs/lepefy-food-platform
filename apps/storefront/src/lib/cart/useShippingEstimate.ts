'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ShippingEstimate } from '@/lib/shipping/tariff/shippingEstimate';
import type { EstimateCountrySource } from '@/lib/shipping/tariff/estimateCountry';
import { useHydratedCartItems } from '@/lib/cart/useHydratedCart';

export type CartShippingEstimate = ShippingEstimate & { source: EstimateCountrySource; countries: string[] };

const CHOSEN_COUNTRY_KEY = 'lepefy-shipping-country';
const CHECKOUT_DRAFT_KEY = 'lepefy-checkout-shipping';

function readChosenCountry(): string | null {
  try { return localStorage.getItem(CHOSEN_COUNTRY_KEY); } catch { return null; }
}

/** Adresse déjà saisie au checkout dans cet onglet : le panier montre alors le même prix que le checkout. */
function readCheckoutAddress(): { country: string; postalCode: string } | null {
  try {
    const raw = sessionStorage.getItem(CHECKOUT_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as { fulfillmentType?: string; country?: unknown; postalCode?: unknown };
    if (draft.fulfillmentType === 'pickup' || typeof draft.country !== 'string' || !draft.country) return null;
    return { country: draft.country, postalCode: typeof draft.postalCode === 'string' ? draft.postalCode : '' };
  } catch {
    return null;
  }
}

/**
 * Estimation du forfait pour le panier courant (POST /api/shipping/estimate).
 * Relancée 400 ms après le dernier changement du panier ; la précédente est
 * annulée. `null` = rien à afficher (pas de forfait, poids manquant, erreur) :
 * le panier garde alors « Livraison calculée à l'étape suivante ».
 * Une seule instance par page (le panier la passe à ses composants).
 */
export function useShippingEstimate({ address = null, enabled = true }: {
  /** Adresse exacte (checkout, après devis) ; sinon celle du brouillon de checkout, du compte, l'IP ou le pays de la boutique. */
  address?: { country: string; postalCode: string } | null;
  enabled?: boolean;
} = {}) {
  const items = useHydratedCartItems();
  const [estimate, setEstimate] = useState<CartShippingEstimate | null>(null);
  const [chosenCountry, setChosen] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // Première réponse reçue (ou panier vide) : le panier peut décider une fois de ses suggestions.
  const [settled, setSettled] = useState(false);

  useEffect(() => { setChosen(readChosenCountry()); setReady(true); }, []);

  const lines = useMemo(() => items.map((item) => ({ productId: item.product.id, quantity: item.quantity })), [items]);
  const key = JSON.stringify([lines, address?.country ?? null, address?.postalCode ?? null, chosenCountry]);

  useEffect(() => {
    if (!ready) return;
    if (!enabled || lines.length === 0) { setEstimate(null); setSettled(true); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch('/api/shipping/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: lines, address: address ?? readCheckoutAddress(), chosenCountry }),
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : { estimate: null }))
        .then((data: { estimate?: CartShippingEstimate | null }) => { setEstimate(data.estimate ?? null); setSettled(true); })
        .catch(() => { if (!controller.signal.aborted) { setEstimate(null); setSettled(true); } });
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
    // `key` résume lignes, adresse et pays choisi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, enabled]);

  const chooseCountry = useCallback((country: string) => {
    try { localStorage.setItem(CHOSEN_COUNTRY_KEY, country); } catch { /* préférence de confort */ }
    setChosen(country);
  }, []);

  return { estimate, settled, chooseCountry };
}
