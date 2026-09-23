/**
 * Verifica server-side delle spese di spedizione in OGNI percorso di pagamento
 * (checkout Stripe, pagamento in negozio, link esterno, modifica e recupero di
 * una checkout session).
 *
 * Invariante: un ordine non arriva mai al pagamento con un importo di
 * spedizione diverso da quello verificato dal server e confermato dal cliente.
 *
 * - `provider_cost` / `shadow`: comportamento V1F invariato (token legacy
 *   `{t,c,z,e}` + eventuale shadow). Un token V2 `tariff` è rifiutato.
 * - `tariff`: richiede un token V2; il server ricalcola peso, zona, versione
 *   attiva e prezzo e li confronta con il token. Ogni differenza → 409
 *   `SHIPPING_REQUOTE_REQUIRED`: il client richiede un nuovo preventivo e il
 *   cliente conferma il nuovo importo. Mai un aumento silenzioso.
 */

import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingPricingMode, ShippingTariffFallback } from '@lepefy/types';
import {
  cartFingerprint, isQuoteTokenV2, normalizeQuotePostalCode, verifyQuote, verifyQuoteV2,
} from '@/lib/shipping/quoteToken';
import { resolveCheckoutShippingDetails, stripShadowTariff } from './shadowTariff';
import { buildTariffShippingDetails, computeTariffQuote, readTariffSnapshot } from './tariffQuote';

type ServiceClient = ReturnType<typeof createServiceClient>;

export const SHIPPING_REQUOTE_REQUIRED = 'SHIPPING_REQUOTE_REQUIRED';
export const REQUOTE_MESSAGE = 'Les frais de livraison doivent être recalculés. Vérifiez le nouveau montant avant de payer.';

export interface CheckoutShippingTenant {
  id: string;
  shipping_pricing_mode?: ShippingPricingMode | string | null;
  shipping_tariff_fallback?: ShippingTariffFallback | string | null;
  click_collect_enabled?: boolean | null;
}

export type CheckoutShippingFailure = { ok: false; status: number; body: { error: string; code?: string } };
export type CheckoutShippingResult =
  | { ok: true; shippingTotal: number; shippingDetails: Record<string, unknown> | null }
  | CheckoutShippingFailure;

/** Modalità effettiva: assente (migration non applicata) = provider_cost. */
export function effectivePricingMode(tenant: Pick<CheckoutShippingTenant, 'shipping_pricing_mode'>): ShippingPricingMode {
  const mode = tenant.shipping_pricing_mode;
  return mode === 'tariff' || mode === 'shadow' ? mode : 'provider_cost';
}

export function tariffFallback(tenant: Pick<CheckoutShippingTenant, 'shipping_tariff_fallback'>): ShippingTariffFallback {
  return tenant.shipping_tariff_fallback === 'provider_cost' ? 'provider_cost' : 'unavailable';
}

export function requote(message = REQUOTE_MESSAGE): CheckoutShippingFailure {
  return { ok: false, status: 409, body: { error: message, code: SHIPPING_REQUOTE_REQUIRED } };
}

const cents = (eur: number) => Math.round(eur * 100);

export interface VerifyCheckoutShippingInput {
  supabase: ServiceClient;
  tenant: CheckoutShippingTenant;
  fulfillmentType: 'delivery' | 'pickup';
  address: { country: string; postal_code: string } | null;
  quoteToken: string | null | undefined;
  quantityByProduct: ReadonlyMap<string, number>;
  /** Subtotale articoli server-side, EUR. */
  subtotal: number;
  clientShippingDetails: Record<string, unknown> | null | undefined;
  secret?: string;
  now?: number;
}

export async function verifyCheckoutShipping(input: VerifyCheckoutShippingInput): Promise<CheckoutShippingResult> {
  const mode = effectivePricingMode(input.tenant);

  if (input.fulfillmentType !== 'delivery') {
    // Ritiro: nessun forfait, nessuna spedizione (comportamento invariato).
    const details = await resolveCheckoutShippingDetails({
      supabase: input.supabase, tenantId: input.tenant.id, pricingMode: mode, fulfillmentType: 'pickup',
      destination: null, quantityByProduct: input.quantityByProduct, subtotal: input.subtotal,
      chargedShippingTotal: 0, clientShippingDetails: input.clientShippingDetails,
    });
    return { ok: true, shippingTotal: 0, shippingDetails: details };
  }

  const secret = input.secret ?? process.env.TRACKING_SECRET;
  if (!secret) {
    console.error('[checkout-shipping] TRACKING_SECRET manquant — impossible de vérifier le devis');
    return { ok: false, status: 500, body: { error: 'Erreur serveur. Veuillez réessayer.' } };
  }
  if (!input.quoteToken || !input.address) {
    return { ok: false, status: 400, body: { error: 'Frais de livraison non calculés. Veuillez repasser par le panier.' } };
  }

  // ── Token V2 ───────────────────────────────────────────────────────────────
  if (isQuoteTokenV2(input.quoteToken)) {
    const verification = verifyQuoteV2(input.quoteToken, secret, input.now);
    if (!verification.valid) {
      return requote(verification.reason === 'expired'
        ? 'Le devis de livraison a expiré. Les frais de livraison doivent être recalculés.'
        : REQUOTE_MESSAGE);
    }
    const q = verification.payload;
    const country = input.address.country.trim().toUpperCase();
    const postalCode = normalizeQuotePostalCode(input.address.postal_code);
    if (q.ten !== input.tenant.id) return requote();
    if (q.c !== country || q.z !== postalCode) {
      return requote('L\'adresse de livraison a changé. Les frais de livraison doivent être recalculés.');
    }
    if (q.h !== cartFingerprint(input.quantityByProduct)) {
      return requote('Votre panier a changé. Les frais de livraison doivent être recalculés.');
    }
    if (mode !== 'tariff') return requote();

    const outcome = await computeTariffQuote({
      supabase: input.supabase, tenantId: input.tenant.id,
      destination: { country, postalCode },
      quantityByProduct: input.quantityByProduct,
      subtotalCents: cents(input.subtotal),
      clickCollectEnabled: Boolean(input.tenant.click_collect_enabled),
    });

    if (q.m === 'tariff') {
      if (outcome.kind !== 'priced') {
        return requote(outcome.kind === 'unavailable' ? outcome.message : REQUOTE_MESSAGE);
      }
      if (outcome.version.id !== q.tid || outcome.version.version !== q.tv
        || outcome.weightG !== q.w || outcome.finalCents !== q.t) {
        console.info('[checkout-shipping] tarif recalculé différent du devis — tenant:', input.tenant.id,
          '— version:', `${q.tv}→${outcome.version.version}`, '— cents:', `${q.t}→${outcome.finalCents}`);
        return requote();
      }
      return {
        ok: true,
        shippingTotal: q.t / 100,
        shippingDetails: buildTariffShippingDetails(outcome, {
          source: q.av, providerQuoteTtcCents: q.pq, carrier: q.cr, service: q.sv,
        }),
      };
    }

    // m = provider_cost : repli explicitement configuré, et seulement si le
    // forfait n'est toujours pas applicable à ce panier.
    if (tariffFallback(input.tenant) !== 'provider_cost' || outcome.kind !== 'fallback') return requote();
    return {
      ok: true,
      shippingTotal: q.t / 100,
      shippingDetails: {
        ...(stripShadowTariff(input.clientShippingDetails) ?? {}),
        pricingMode: 'provider_cost_fallback',
        tariffFallback: { reason: outcome.reason, missingProductIds: outcome.missingProductIds },
      },
    };
  }

  // ── Token legacy ───────────────────────────────────────────────────────────
  // Jamais une autorisation pour le forfait commercial.
  if (mode === 'tariff') return requote();

  const verification = verifyQuote(input.quoteToken, secret);
  if (!verification.valid) {
    return { ok: false, status: 400, body: { error: 'Le devis de livraison a expiré. Veuillez repasser par le panier.' } };
  }
  const quote = verification.payload;
  if (quote.c !== input.address.country || quote.z !== input.address.postal_code) {
    return { ok: false, status: 400, body: { error: 'L\'adresse de livraison a changé. Veuillez recalculer les frais depuis le panier.' } };
  }
  const details = await resolveCheckoutShippingDetails({
    supabase: input.supabase, tenantId: input.tenant.id, pricingMode: mode, fulfillmentType: 'delivery',
    destination: { country: input.address.country, postalCode: input.address.postal_code },
    quantityByProduct: input.quantityByProduct, subtotal: input.subtotal,
    chargedShippingTotal: quote.t, clientShippingDetails: input.clientShippingDetails,
  });
  return { ok: true, shippingTotal: quote.t, shippingDetails: details };
}

export interface RevalidateSessionShippingInput {
  supabase: ServiceClient;
  tenant: CheckoutShippingTenant;
  fulfillmentType: 'delivery' | 'pickup';
  address: { country: string; postal_code: string } | null;
  shippingDetails: Record<string, unknown> | null | undefined;
  shippingTotal: number;
  quantityByProduct: ReadonlyMap<string, number>;
  subtotal: number;
}

/**
 * Sessione riusata SENZA nuovo preventivo (recupero, create-intent, PATCH che
 * non porta un nuovo token): l'importo salvato resta valido solo se la
 * tariffa attiva, il carrello e l'indirizzo producono ancora lo stesso prezzo.
 * `tariffManaged` = lo snapshot della sessione appartiene alla V1G e va
 * conservato tale e quale.
 */
export async function revalidateSessionShipping(input: RevalidateSessionShippingInput):
  Promise<{ ok: true; tariffManaged: boolean } | CheckoutShippingFailure> {
  if (input.fulfillmentType !== 'delivery') return { ok: true, tariffManaged: false };
  const mode = effectivePricingMode(input.tenant);
  const snapshot = readTariffSnapshot(input.shippingDetails);
  const isFallback = input.shippingDetails?.pricingMode === 'provider_cost_fallback';

  if (mode !== 'tariff') {
    // Tariffa ritirata dopo il preventivo: il prezzo va ricalcolato col flusso attuale.
    return snapshot || isFallback ? requote() : { ok: true, tariffManaged: false };
  }
  if (!input.address || (!snapshot && !isFallback)) return requote();

  const country = input.address.country.trim().toUpperCase();
  const postalCode = normalizeQuotePostalCode(input.address.postal_code);
  const outcome = await computeTariffQuote({
    supabase: input.supabase, tenantId: input.tenant.id, destination: { country, postalCode },
    quantityByProduct: input.quantityByProduct, subtotalCents: cents(input.subtotal),
    clickCollectEnabled: Boolean(input.tenant.click_collect_enabled),
  });

  if (snapshot) {
    const same = outcome.kind === 'priced'
      && snapshot.country === country && snapshot.postalCode === postalCode
      && outcome.version.id === snapshot.versionId && outcome.version.version === snapshot.version
      && outcome.weightG === snapshot.weightG
      && outcome.finalCents === snapshot.finalCents
      && cents(input.shippingTotal) === snapshot.finalCents;
    return same ? { ok: true, tariffManaged: true } : requote();
  }
  return outcome.kind === 'fallback' && tariffFallback(input.tenant) === 'provider_cost'
    ? { ok: true, tariffManaged: true }
    : requote();
}
