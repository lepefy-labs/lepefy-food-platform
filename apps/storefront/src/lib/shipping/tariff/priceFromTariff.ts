/**
 * Motore tariffario forfait — puro e deterministico.
 *
 * Indipendente da Next.js, Supabase e dal provider logistico: riceve uno
 * snapshot tariffario già validato (`parseTariffVersion`) e il contesto di
 * spedizione, restituisce prezzo e breakdown. Tutti gli importi sono interi
 * in centesimi e tutti i pesi interi in grammi: nessun errore di confine o di
 * arrotondamento sui float.
 *
 * Semantica (docs/SHIPPING_FLAT_RATE_CHECKOUT.md §5.3):
 * - fasce `min_g_exclusive < peso ≤ max_g_inclusive` (5 000 g → 0–5 kg, 5 001 g → 5–10 kg);
 * - blocchi: oltre `block_weight_g`, `blocchi = floor(peso / blocco)` e
 *   `prezzo = blocchi × prezzo_blocco + fascia(resto)` (resto 0 → nessuna fascia);
 * - colli teorici a riempimento progressivo (20 kg / 15 → 15 + 5);
 * - maggiorazione di zona per collo o per ordine;
 * - IVA: prezzi TTC di default; se esclusa, applicata una volta con l'aliquota del paese.
 *
 * Un prezzo teorico NON implica che il provider accetti la spedizione: la
 * fattibilità logistica resta separata (`warnings`).
 */

import { splitParcelWeightsFilled } from '@/lib/shipping/cartonSuggestion';
import { applyCountryRule, type ShippingCountryRule } from '@/lib/shipping/resolveCountryRule';
import type {
  ShippingTariffVersionBand,
  ShippingTariffVersionZoneSurcharge,
} from '@lepefy/types';

export interface TariffSnapshot {
  id: string;
  version: number;
  country: string;
  currency: string;
  bands: ShippingTariffVersionBand[];
  zoneSurcharges: ShippingTariffVersionZoneSurcharge[];
  nonDeliverableZones: string[];
  maxParcelWeightG: number;
  blockWeightG: number | null;
  blockPriceCents: number | null;
  logisticsVerifiedMaxWeightG: number | null;
  pricesIncludeVat: boolean;
}

export interface TariffPricingContext {
  /** Peso netto validato, grammi interi. */
  weightG: number;
  country: string;
  zoneCode: string | null;
  /** Aliquota IVA del paese (0.22). Obbligatoria solo se la tariffa è HT. */
  vatRate?: number | null;
}

export type TariffUnavailableReason =
  | 'country_mismatch'
  | 'invalid_weight'
  | 'zone_not_deliverable'
  | 'band_not_covered'
  | 'vat_rate_missing';

export type TariffWarning = 'logistics_unverified_weight';

export interface TariffBandUsed {
  minGExclusive: number;
  maxGInclusive: number | null;
  priceCents: number;
}

export interface TariffZoneSurchargeApplied {
  zoneCode: string;
  mode: 'per_parcel' | 'per_order';
  amountCents: number;
  totalCents: number;
}

export type TariffPriceResult =
  | {
      available: true;
      country: string;
      zoneCode: string | null;
      weightG: number;
      blocks: number;
      blockWeightG: number | null;
      blockPriceCents: number | null;
      remainderWeightG: number;
      band: TariffBandUsed | null;
      parcelsG: number[];
      numParcels: number;
      zoneSurcharge: TariffZoneSurchargeApplied | null;
      /** Blocchi + fascia, prima della maggiorazione di zona (valuta della tariffa, IVA come configurata). */
      baseCents: number;
      /** Base + maggiorazione di zona, IVA come configurata nella tariffa. */
      configuredTotalCents: number;
      vat: { includedInTariff: boolean; rate: number | null; amountCents: number | null };
      /** Prezzo teorico TTC, prima delle regole commerciali paese. */
      totalTtcCents: number;
      warnings: TariffWarning[];
    }
  | {
      available: false;
      reason: TariffUnavailableReason;
      country: string;
      zoneCode: string | null;
      weightG: number;
    };

export function findBand(bands: ShippingTariffVersionBand[], weightG: number): ShippingTariffVersionBand | null {
  return bands.find((b) => weightG > b.min_g_exclusive && (b.max_g_inclusive === null || weightG <= b.max_g_inclusive)) ?? null;
}

export function priceFromTariff(tariff: TariffSnapshot, ctx: TariffPricingContext): TariffPriceResult {
  const country = ctx.country.trim().toUpperCase();
  const zoneCode = ctx.zoneCode;
  const weightG = ctx.weightG;
  const unavailable = (reason: TariffUnavailableReason): TariffPriceResult =>
    ({ available: false, reason, country, zoneCode, weightG });

  if (country !== tariff.country) return unavailable('country_mismatch');
  if (!Number.isInteger(weightG) || weightG <= 0) return unavailable('invalid_weight');
  if (zoneCode && tariff.nonDeliverableZones.includes(zoneCode)) return unavailable('zone_not_deliverable');

  let blocks = 0;
  let remainderWeightG = weightG;
  if (tariff.blockWeightG !== null && tariff.blockPriceCents !== null && weightG > tariff.blockWeightG) {
    blocks = Math.floor(weightG / tariff.blockWeightG);
    remainderWeightG = weightG - blocks * tariff.blockWeightG;
  }

  let band: TariffBandUsed | null = null;
  if (remainderWeightG > 0) {
    const found = findBand(tariff.bands, remainderWeightG);
    if (!found) return unavailable('band_not_covered');
    band = { minGExclusive: found.min_g_exclusive, maxGInclusive: found.max_g_inclusive, priceCents: found.price_cents };
  }

  const baseCents = blocks * (tariff.blockPriceCents ?? 0) + (band?.priceCents ?? 0);
  const parcelsG = splitParcelWeightsFilled(weightG, tariff.maxParcelWeightG);

  let zoneSurcharge: TariffZoneSurchargeApplied | null = null;
  const surcharge = zoneCode ? tariff.zoneSurcharges.find((z) => z.zone_code === zoneCode) : undefined;
  if (surcharge && surcharge.amount_cents > 0) {
    zoneSurcharge = {
      zoneCode: surcharge.zone_code,
      mode: surcharge.mode,
      amountCents: surcharge.amount_cents,
      totalCents: surcharge.mode === 'per_parcel' ? surcharge.amount_cents * parcelsG.length : surcharge.amount_cents,
    };
  }

  const configuredTotalCents = baseCents + (zoneSurcharge?.totalCents ?? 0);
  const rate = typeof ctx.vatRate === 'number' && Number.isFinite(ctx.vatRate) && ctx.vatRate >= 0 ? ctx.vatRate : null;

  let totalTtcCents: number;
  let vatAmountCents: number | null;
  if (tariff.pricesIncludeVat) {
    totalTtcCents = configuredTotalCents;
    vatAmountCents = rate === null ? null : configuredTotalCents - Math.round(configuredTotalCents / (1 + rate));
  } else {
    if (rate === null) return unavailable('vat_rate_missing');
    vatAmountCents = Math.round(configuredTotalCents * rate);
    totalTtcCents = configuredTotalCents + vatAmountCents;
  }

  const warnings: TariffWarning[] = [];
  if (tariff.logisticsVerifiedMaxWeightG !== null && weightG > tariff.logisticsVerifiedMaxWeightG) {
    warnings.push('logistics_unverified_weight');
  }

  return {
    available: true,
    country,
    zoneCode,
    weightG,
    blocks,
    blockWeightG: blocks > 0 ? tariff.blockWeightG : null,
    blockPriceCents: blocks > 0 ? tariff.blockPriceCents : null,
    remainderWeightG,
    band,
    parcelsG,
    numParcels: parcelsG.length,
    zoneSurcharge,
    baseCents,
    configuredTotalCents,
    vat: { includedInTariff: tariff.pricesIncludeVat, rate, amountCents: vatAmountCents },
    totalTtcCents,
    warnings,
  };
}

export interface CommercialRulesResult {
  ruleApplied: boolean;
  /** Prezzo teorico del forfait, prima delle regole. */
  theoreticalCents: number;
  /** Base dopo l'eventuale flat_rate_override (precedenza esplicita). */
  afterOverrideCents: number;
  overrideApplied: boolean;
  discountCents: number;
  freeShippingApplied: boolean;
  finalCents: number;
}

/**
 * Regole commerciali paese sopra il forfait, con la STESSA precedenza del
 * checkout live (`applyCountryRule`, riusata e non reimplementata):
 * 1. forfait teorico → 2. flat_rate_override → 3. sconto → 4. free_shipping_above
 * sul subtotale server-side. Le regole inattive non sono mai caricate dal
 * chiamante, quindi non si applicano. `packaging_surcharges` non entra mai
 * qui: il forfait include già l'imballaggio.
 */
export function applyCommercialRulesCents(
  theoreticalCents: number,
  subtotalCents: number,
  rule: ShippingCountryRule | null,
): CommercialRulesResult {
  const applied = applyCountryRule(theoreticalCents / 100, subtotalCents / 100, rule);
  return {
    ruleApplied: applied.ruleUsed,
    theoreticalCents,
    afterOverrideCents: Math.round(applied.originalCost * 100),
    overrideApplied: Boolean(rule && rule.flat_rate_override != null),
    discountCents: Math.round(applied.discountApplied * 100),
    freeShippingApplied: applied.freeShippingApplied,
    finalCents: Math.round(applied.finalCost * 100),
  };
}
