/**
 * Shadow mode del forfait di spedizione (V1F).
 *
 * Il cliente paga SEMPRE l'importo del flusso shipping esistente (token HMAC
 * verificato). In parallelo, se `tenants.shipping_pricing_mode = 'shadow'`,
 * il server calcola il forfait sperimentale con dati autorevoli:
 *   prodotti/quantità validati da `validateCheckoutItems` + `products.weight_grams`
 *   → zona tenant (`resolveZoneCode`) → `priceFromTariff` (versione shadow)
 *   → regole paese → `shipping_details.shadow_tariff`.
 *
 * Invarianti:
 * - `resolveCheckoutShippingDetails` non lancia mai e non modifica shippingTotal,
 *   totale, PaymentIntent o token: in caso di errore restituisce i dettagli
 *   originali con uno shadow in stato `error`;
 * - un `shadow_tariff` inviato dal browser viene sempre scartato;
 * - con pricing mode diverso da `shadow` i dettagli restano quelli di oggi
 *   (`provider_cost`), oppure sono lo snapshot commerciale V1G (`tariff`,
 *   vedi checkoutShipping.ts): nessuna simulazione in parallelo;
 * - nessun fallback di peso: un prodotto senza peso rende il calcolo incompleto;
 * - il ritiro in negozio non riceve alcun calcolo (escluso esplicitamente).
 */

import type { createServiceClient } from '@/lib/supabase/server';
import type { ShippingTariffVersionRow, ShippingPricingMode } from '@lepefy/types';
import { resolveCountryRule, type ShippingCountryRule } from '@/lib/shipping/resolveCountryRule';
import { resolveVatRate, type VatRate } from '@/lib/shipping/calculateShipping';
import { resolveZoneCode } from '@/lib/shipping/intelligence/resolveZone';
import { applyCommercialRulesCents, priceFromTariff, type CommercialRulesResult, type TariffUnavailableReason } from './priceFromTariff';
import { parseTariffVersion } from './tariffVersion';

type ServiceClient = ReturnType<typeof createServiceClient>;

export const SHADOW_TARIFF_KEY = 'shadow_tariff';
export const SHADOW_TIMEOUT_MS = 2500;

export type ShadowTariffStatus = 'complete' | 'incomplete' | 'unavailable' | 'error';

export type ShadowTariffReason =
  | 'no_shadow_tariff'
  | 'missing_product_weight'
  | 'zone_unresolved'
  | 'band_not_covered'
  | 'zone_not_deliverable'
  | 'invalid_tariff_config'
  | 'vat_rate_missing'
  | 'invalid_weight'
  | 'country_mismatch'
  | 'timeout'
  | 'unexpected_exception';

export type ProviderQuoteVerification = 'matches_signed_total' | 'unverified' | 'not_available';

export interface ShadowTariffRecord {
  schema: 1;
  status: ShadowTariffStatus;
  reasons: ShadowTariffReason[];
  computedAt: string;
  tariff: { versionId: string; version: number; country: string; currency: string; pricesIncludeVat: boolean } | null;
  destination: { country: string; postalCode: string; zoneCode: string | null };
  weight: {
    /** Peso netto prodotti da products.weight_grams × quantità validate; null se incompleto. */
    netG: number | null;
    missingWeightProductIds: string[];
    /** Tara cartone: non configurata in V1F, mai sommata al peso di fascia. */
    tareG: null;
  };
  pricing: {
    blocks: number;
    blockWeightG: number | null;
    blockPriceCents: number | null;
    remainderWeightG: number;
    band: { minGExclusive: number; maxGInclusive: number | null; priceCents: number } | null;
    parcelsG: number[];
    numParcels: number;
    zoneSurcharge: { zoneCode: string; mode: 'per_parcel' | 'per_order'; amountCents: number; totalCents: number } | null;
    baseCents: number;
    vatRate: number | null;
    vatIncludedInTariff: boolean;
    vatAmountCents: number | null;
    theoreticalTtcCents: number;
  } | null;
  commercial: CommercialRulesResult | null;
  /** Importo shadow finale TTC (dopo regole paese). */
  shadowTtcCents: number | null;
  /** Importo realmente addebitato (dal token firmato). */
  chargedCents: number;
  provider: {
    verification: ProviderQuoteVerification;
    /** Preventivo provider TTC (base + IVA, senza imballaggio). */
    quoteTtcCents: number | null;
    packagingSurchargeChargedCents: number | null;
  };
  /** Costo imballaggio reale: non comunicato dal tenant → mai stimato. */
  packagingCostCents: null;
  comparison: {
    /** Differenza fra due prezzi cliente (forfait − addebitato): NON è un margine. */
    shadowMinusChargedCents: number | null;
    /** Forfait − preventivo provider TTC verificato, prima dell'imballaggio. */
    expectedMarginBeforePackagingCents: number | null;
    /** Margine completo: richiede il costo reale dell'imballaggio (non disponibile). */
    expectedMarginCents: null;
  };
  warnings: string[];
}

/** La simulazione shadow gira solo in modalità `shadow` (mai in `tariff`, dove il forfait è il prezzo reale). */
export function resolveShadowEnabled(mode: ShippingPricingMode | string | null | undefined): boolean {
  return mode === 'shadow';
}

export function stripShadowTariff(details: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return details ?? null;
  if (!(SHADOW_TARIFF_KEY in details)) return details;
  const { [SHADOW_TARIFF_KEY]: _dropped, ...rest } = details;
  return rest;
}

const cents = (eur: number) => Math.round(eur * 100);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Preventivo provider dai dettagli del quote (eco del browser, non firmato):
 * accettato solo se ricostruisce esattamente il totale firmato.
 */
export function verifyProviderQuote(
  details: Record<string, unknown> | null,
  chargedCents: number,
): ShadowTariffRecord['provider'] {
  const packlinkCost = num(details?.packlinkCost);
  const vatAmount = num(details?.vatAmount);
  const packaging = num(details?.packagingSurchargeTotal);
  if (packlinkCost === null || vatAmount === null || packaging === null) {
    return { verification: 'not_available', quoteTtcCents: null, packagingSurchargeChargedCents: null };
  }
  const quoteTtcCents = cents(packlinkCost) + cents(vatAmount);
  const matches = details?.countryRuleApplied !== true && quoteTtcCents + cents(packaging) === chargedCents;
  return {
    verification: matches ? 'matches_signed_total' : 'unverified',
    quoteTtcCents: matches ? quoteTtcCents : null,
    packagingSurchargeChargedCents: matches ? cents(packaging) : null,
  };
}

export interface ShadowTariffInput {
  supabase: ServiceClient;
  tenantId: string;
  destination: { country: string; postalCode: string };
  /** Quantità per prodotto già validate server-side. */
  quantityByProduct: ReadonlyMap<string, number>;
  /** Subtotale articoli server-side, EUR. */
  subtotal: number;
  /** shippingTotal verificato dal token HMAC, EUR. */
  chargedShippingTotal: number;
  liveShippingDetails: Record<string, unknown> | null;
  now?: Date;
}

const ENGINE_REASON: Record<TariffUnavailableReason, ShadowTariffReason> = {
  country_mismatch: 'country_mismatch',
  invalid_weight: 'invalid_weight',
  zone_not_deliverable: 'zone_not_deliverable',
  band_not_covered: 'band_not_covered',
  vat_rate_missing: 'vat_rate_missing',
};

function baseRecord(input: ShadowTariffInput): ShadowTariffRecord {
  const chargedCents = cents(input.chargedShippingTotal);
  return {
    schema: 1,
    status: 'error',
    reasons: [],
    computedAt: (input.now ?? new Date()).toISOString(),
    tariff: null,
    destination: {
      country: input.destination.country.trim().toUpperCase(),
      postalCode: input.destination.postalCode.trim().toUpperCase(),
      zoneCode: null,
    },
    weight: { netG: null, missingWeightProductIds: [], tareG: null },
    pricing: null,
    commercial: null,
    shadowTtcCents: null,
    chargedCents,
    provider: verifyProviderQuote(input.liveShippingDetails, chargedCents),
    packagingCostCents: null,
    comparison: { shadowMinusChargedCents: null, expectedMarginBeforePackagingCents: null, expectedMarginCents: null },
    warnings: [],
  };
}

export async function computeShadowTariff(input: ShadowTariffInput): Promise<ShadowTariffRecord> {
  const { supabase, tenantId } = input;
  const record = baseRecord(input);
  const country = record.destination.country;

  const { data: versionRow, error: versionError } = await supabase
    .from('shipping_tariff_versions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('country', country)
    .eq('status', 'shadow')
    .maybeSingle();
  if (versionError) throw new Error(`tariff_version_lookup_failed:${(versionError as { code?: string }).code ?? 'unknown'}`);
  if (!versionRow) return { ...record, status: 'unavailable', reasons: ['no_shadow_tariff'] };

  const parsed = parseTariffVersion(versionRow as ShippingTariffVersionRow);
  const row = versionRow as ShippingTariffVersionRow;
  record.tariff = { versionId: row.id, version: row.version, country: row.country, currency: row.currency, pricesIncludeVat: row.prices_include_vat };
  if (!parsed.ok) return { ...record, status: 'error', reasons: ['invalid_tariff_config'] };

  const productIds = [...input.quantityByProduct.keys()];
  const [productsResult, zoneCode, rulesResult, vatResult] = await Promise.all([
    supabase.from('products').select('id, weight_grams').eq('tenant_id', tenantId).in('id', productIds),
    resolveZoneCode(supabase, tenantId, country, record.destination.postalCode),
    supabase.from('shipping_country_rules')
      .select('countries, free_shipping_above, flat_rate_override, discount_type, discount_value')
      .eq('tenant_id', tenantId).eq('active', true),
    supabase.from('shipping_vat_rates').select('countries, vat_rate').eq('tenant_id', tenantId).eq('active', true),
  ]);
  if (productsResult.error) throw new Error('product_weight_lookup_failed');
  if (rulesResult.error || vatResult.error) throw new Error('shipping_config_lookup_failed');
  record.destination.zoneCode = zoneCode;

  const weightById = new Map(((productsResult.data ?? []) as Array<{ id: string; weight_grams: number | null }>)
    .map((p) => [p.id, p.weight_grams]));
  let netG = 0;
  const missing: string[] = [];
  for (const [productId, quantity] of input.quantityByProduct) {
    const w = weightById.get(productId);
    if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0) missing.push(productId);
    else netG += Math.round(w) * quantity;
  }
  record.weight.missingWeightProductIds = missing.sort();
  if (missing.length > 0) return { ...record, status: 'incomplete', reasons: ['missing_product_weight'] };
  record.weight.netG = netG;

  const vatRate = resolveVatRate(country, (vatResult.data ?? []) as VatRate[]);
  const price = priceFromTariff(parsed.tariff, { weightG: netG, country, zoneCode, vatRate });
  if (!price.available) return { ...record, status: 'unavailable', reasons: [ENGINE_REASON[price.reason]] };

  const rule = resolveCountryRule(country, (rulesResult.data ?? []) as ShippingCountryRule[]);
  const commercial = applyCommercialRulesCents(price.totalTtcCents, cents(input.subtotal), rule);
  const reasons: ShadowTariffReason[] = zoneCode ? [] : ['zone_unresolved'];

  const expectedMargin = record.provider.quoteTtcCents !== null && reasons.length === 0
    ? commercial.finalCents - record.provider.quoteTtcCents
    : null;

  return {
    ...record,
    status: reasons.length > 0 ? 'incomplete' : 'complete',
    reasons,
    pricing: {
      blocks: price.blocks,
      blockWeightG: price.blockWeightG,
      blockPriceCents: price.blockPriceCents,
      remainderWeightG: price.remainderWeightG,
      band: price.band,
      parcelsG: price.parcelsG,
      numParcels: price.numParcels,
      zoneSurcharge: price.zoneSurcharge,
      baseCents: price.baseCents,
      vatRate: price.vat.rate,
      vatIncludedInTariff: price.vat.includedInTariff,
      vatAmountCents: price.vat.amountCents,
      theoreticalTtcCents: price.totalTtcCents,
    },
    commercial,
    shadowTtcCents: commercial.finalCents,
    comparison: {
      shadowMinusChargedCents: commercial.finalCents - record.chargedCents,
      expectedMarginBeforePackagingCents: expectedMargin,
      expectedMarginCents: null,
    },
    warnings: [...price.warnings],
  };
}

/** Log assaini : seuls nos propres codes d'erreur sont journalisés, jamais un message brut. */
function safeErrorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  return /^[a-z_]+(:[A-Za-z0-9_]+)?$/.test(message) ? message : err instanceof Error ? err.name : 'unknown';
}

function errorRecord(input: ShadowTariffInput, reason: ShadowTariffReason): ShadowTariffRecord {
  return { ...baseRecord(input), status: 'error', reasons: [reason] };
}

export interface ResolveCheckoutShippingDetailsInput extends Omit<ShadowTariffInput, 'destination' | 'liveShippingDetails'> {
  pricingMode: ShippingPricingMode | string | null | undefined;
  fulfillmentType: 'delivery' | 'pickup';
  destination: { country: string; postalCode: string } | null;
  clientShippingDetails: Record<string, unknown> | null | undefined;
  timeoutMs?: number;
}

/**
 * `shipping_details` da persistere su checkout_sessions/orders: i dettagli del
 * quote attuale (senza shadow client) + lo shadow server-side quando attivo.
 * Non lancia mai; non tocca mai gli importi.
 */
export async function resolveCheckoutShippingDetails(
  input: ResolveCheckoutShippingDetailsInput,
): Promise<Record<string, unknown> | null> {
  const sanitized = stripShadowTariff(input.clientShippingDetails);
  try {
    if (!resolveShadowEnabled(input.pricingMode)) return sanitized;
    if (input.fulfillmentType !== 'delivery' || !input.destination?.country || !input.destination.postalCode) return sanitized;

    const shadowInput: ShadowTariffInput = { ...input, destination: input.destination, liveShippingDetails: sanitized };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ShadowTariffRecord>((resolve) => {
      timer = setTimeout(() => resolve(errorRecord(shadowInput, 'timeout')), input.timeoutMs ?? SHADOW_TIMEOUT_MS);
    });
    let record: ShadowTariffRecord;
    try {
      record = await Promise.race([
        computeShadowTariff(shadowInput).catch((err: unknown) => {
          console.error('[shadow-tariff] calcul échoué — tenant:', input.tenantId, '—', safeErrorCode(err));
          return errorRecord(shadowInput, 'unexpected_exception');
        }),
        timeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (record.status !== 'complete') {
      console.info('[shadow-tariff] tenant:', input.tenantId, '— status:', record.status, '— reasons:', record.reasons.join(','));
    }
    return { ...(sanitized ?? {}), [SHADOW_TARIFF_KEY]: record };
  } catch (err) {
    console.error('[shadow-tariff] exception inattendue — tenant:', input.tenantId, '—', safeErrorCode(err));
    return sanitized;
  }
}
