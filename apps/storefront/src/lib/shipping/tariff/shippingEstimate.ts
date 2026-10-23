/**
 * Estimation du forfait affichée au panier et au checkout — pure.
 *
 * Même moteur que le devis (`priceFromTariff` + `applyCommercialRulesCents`),
 * jamais un second calcul. En plus du prix, donne la « marge de tranche » :
 * combien de grammes le client peut encore ajouter sans que SES frais de
 * livraison augmentent (fin de tranche, nouveau bloc, nouveau colis quand un
 * supplément de zone est facturé par colis).
 *
 * Ce qui sort d'ici est volontairement minimal (décision produit) : prix
 * estimé, marge arrondie à 100 g INFÉRIEURS, supplément de zone possible.
 * Jamais les bornes des tranches, jamais un « vous dépassez de … ».
 */

import type { ShippingCountryRule } from '@/lib/shipping/resolveCountryRule';
import { applyCommercialRulesCents, priceFromTariff, type TariffSnapshot } from './priceFromTariff';

/** Marge affichée arrondie à cette précision, vers le bas : toujours vraie, ne révèle pas les bornes au gramme. */
export const HEADROOM_STEP_G = 100;
/** Au-delà, la marge n'est plus une information utile (et le calcul reste borné). */
export const HEADROOM_HORIZON_G = 60_000;

export interface ShippingEstimateInput {
  tariff: TariffSnapshot;
  /** Poids net du panier (somme poids × quantité, grammes entiers, > 0). */
  weightG: number;
  /** Zone connue (CP saisi) ; `undefined` = CP inconnu : prix continental, marge prudente pour toutes les zones. */
  zoneCode?: string | null;
  vatRate: number | null;
  subtotalCents: number;
  rule: ShippingCountryRule | null;
}

export interface ShippingEstimate {
  country: string;
  /** Zone connue : prix exact pour l'adresse. */
  exact: boolean;
  finalCents: number;
  freeShipping: boolean;
  /** Montant d'articles restant pour la livraison offerte (règle pays), null sinon. */
  freeShippingRemainingCents: number | null;
  /** Grammes encore ajoutables sans hausse des frais, arrondis à 100 g inférieurs ; null = rien d'utile à dire. */
  headroomG: number | null;
  /** CP inconnu et supplément de zone possible (îles) : montant le plus élevé, à signaler à côté du prix. */
  zoneSurcharge: { amountCents: number; perParcel: boolean } | null;
}

function finalCentsAt(input: ShippingEstimateInput, weightG: number, zoneCode: string | null): number | null {
  const price = priceFromTariff(input.tariff, { weightG, country: input.tariff.country, zoneCode, vatRate: input.vatRate });
  if (!price.available) return null;
  return applyCommercialRulesCents(price.totalTtcCents, input.subtotalCents, input.rule).finalCents;
}

/**
 * Poids absolus (> weightG) où le prix PEUT changer : juste après la fin de
 * chaque tranche, à chaque multiple de bloc et juste après, au premier gramme
 * de chaque nouveau colis. Entre deux de ces points, le prix est constant.
 */
export function priceBreakpoints(tariff: TariffSnapshot, weightG: number, horizonG = HEADROOM_HORIZON_G): number[] {
  const limit = weightG + horizonG;
  const points = new Set<number>();
  const block = tariff.blockWeightG !== null && tariff.blockPriceCents !== null && tariff.blockWeightG > 0 ? tariff.blockWeightG : null;
  const blocks = block ? Math.floor(limit / block) + 1 : 0;
  for (let k = 0; k <= blocks; k += 1) {
    const base = k * (block ?? 0);
    if (base > limit) break;
    for (const band of tariff.bands) {
      points.add(base + band.min_g_exclusive + 1);
      if (band.max_g_inclusive !== null) points.add(base + band.max_g_inclusive + 1);
    }
    if (block && k > 0) { points.add(k * block); points.add(k * block + 1); }
  }
  if (tariff.maxParcelWeightG > 0) {
    for (let n = 1; n * tariff.maxParcelWeightG < limit; n += 1) points.add(n * tariff.maxParcelWeightG + 1);
  }
  return [...points].filter((point) => point > weightG && point <= limit).sort((a, b) => a - b);
}

/** Grammes ajoutables avant la première hausse des frais pour cette zone ; null = aucune hausse dans l'horizon. */
export function exactHeadroomG(input: ShippingEstimateInput, zoneCode: string | null): number | null {
  const current = finalCentsAt(input, input.weightG, zoneCode);
  if (current === null) return 0;
  for (const point of priceBreakpoints(input.tariff, input.weightG)) {
    const next = finalCentsAt(input, point, zoneCode);
    if (next === null || next > current) return point - 1 - input.weightG;
  }
  return null;
}

export function estimateShipping(input: ShippingEstimateInput): ShippingEstimate | null {
  if (!Number.isInteger(input.weightG) || input.weightG <= 0) return null;
  const exact = input.zoneCode !== undefined;
  const zoneCode = input.zoneCode ?? null;
  const finalCents = finalCentsAt(input, input.weightG, zoneCode);
  if (finalCents === null) return null;

  const threshold = input.rule?.free_shipping_above;
  const freeShipping = finalCents === 0;
  const thresholdCents = typeof threshold === 'number' && threshold > 0 ? Math.round(threshold * 100) : null;
  const freeShippingRemainingCents = !freeShipping && thresholdCents !== null && thresholdCents > input.subtotalCents
    ? thresholdCents - input.subtotalCents
    : null;

  // Livraison offerte : la marge de poids n'a plus de sens.
  let headroomG: number | null = null;
  if (!freeShipping) {
    // CP inconnu : la marge doit rester vraie pour toutes les zones (continent et zones à supplément).
    const zones = exact ? [zoneCode] : [null, ...input.tariff.zoneSurcharges.filter((z) => z.amount_cents > 0).map((z) => z.zone_code)];
    // null = aucune hausse dans l'horizon pour cette zone (prix fixe) : seules les zones bornées comptent.
    const bounded = zones.map((zone) => exactHeadroomG(input, zone)).filter((margin): margin is number => margin !== null);
    if (bounded.length) {
      const rounded = Math.floor(Math.min(...bounded) / HEADROOM_STEP_G) * HEADROOM_STEP_G;
      headroomG = rounded >= HEADROOM_STEP_G ? rounded : null;
    }
  }

  const surcharges = exact ? [] : input.tariff.zoneSurcharges.filter((z) => z.amount_cents > 0);
  const zoneSurcharge = surcharges.length
    ? {
      amountCents: Math.max(...surcharges.map((z) => z.amount_cents)),
      perParcel: surcharges.some((z) => z.mode === 'per_parcel'),
    }
    : null;

  return {
    country: input.tariff.country,
    exact,
    finalCents,
    freeShipping,
    freeShippingRemainingCents,
    headroomG,
    zoneSurcharge: freeShipping ? null : zoneSurcharge,
  };
}

/** « 2,8 kg » / « 600 g » : marge lisible, jamais plus précise que 100 g. */
export function formatHeadroom(headroomG: number): string {
  if (headroomG < 1000) return `${headroomG} g`;
  return `${(headroomG / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg`;
}
