/**
 * Prezzo unitario Lepefy a partire dal prezzo WhatsApp di un lotto.
 *
 * Nel catalogo WhatsApp il prezzo mostrato è il totale per la quantità minima
 * ("3 paquets de 500g" → 10,00 €), mentre `products.price` è il prezzo
 * all'unità. Formula (approvata, docs/WHATSAPP_EXTERNAL_CATALOG_IMPORT.md):
 *
 *   prezzo unitario = (prezzo lotto ÷ quantità minima) × (1 − sconto %)
 *
 * arrotondato al centesimo. Calcolo in interi (centesimi × punti base) per
 * evitare gli errori dei float; lo scarto dovuto all'arrotondamento è sempre
 * restituito perché la UI lo mostri (10 € ÷ 3 = 3,33 € → lotto 9,99 €).
 * Funzione pura: usata sia dalla UI sia dai test.
 */

export type PriceRounding = 'nearest' | 'up' | 'down';

export const MAX_DISCOUNT_PCT = 90;

export interface UnitPriceInput {
  /** Prezzo WhatsApp del lotto, in unità maggiori (10.00). */
  lotPrice: number;
  /** Quantità minima a cui il prezzo si riferisce (≥ 1). */
  minQuantity: number;
  /** Sconto in percentuale, 0–90, max 2 decimali. */
  discountPct: number;
  rounding: PriceRounding;
}

export interface UnitPriceResult {
  unitPrice: number;
  unitCents: number;
  /** Prezzo unitario × minimo, cioè quanto paga il cliente al minimo. */
  lotTotal: number;
  /** Prezzo del lotto dopo lo sconto, prima dell'arrotondamento al pezzo. */
  discountedLot: number;
  /** lotTotal − discountedLot (0 se la divisione è esatta). */
  roundingDelta: number;
}

function divRound(num: number, den: number, rounding: PriceRounding): number {
  const q = Math.trunc(num / den);
  const rem = num - q * den;
  if (rem === 0) return q;
  if (rounding === 'down') return q;
  if (rounding === 'up') return q + 1;
  return rem * 2 >= den ? q + 1 : q;
}

export function computeUnitPrice(input: UnitPriceInput): UnitPriceResult | null {
  const { lotPrice, minQuantity, discountPct, rounding } = input;
  if (!Number.isFinite(lotPrice) || lotPrice <= 0) return null;
  if (!Number.isInteger(minQuantity) || minQuantity < 1) return null;
  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > MAX_DISCOUNT_PCT) return null;

  const lotCents = Math.round(lotPrice * 100);
  const discountBp = Math.round(discountPct * 100);          // 12.5 % → 1250
  const keepBp = 10_000 - discountBp;
  const unitCents = divRound(lotCents * keepBp, minQuantity * 10_000, rounding);
  if (unitCents <= 0) return null;
  const discountedLotCents = divRound(lotCents * keepBp, 10_000, 'nearest');
  const lotTotalCents = unitCents * minQuantity;
  return {
    unitPrice: unitCents / 100,
    unitCents,
    lotTotal: lotTotalCents / 100,
    discountedLot: discountedLotCents / 100,
    roundingDelta: (lotTotalCents - discountedLotCents) / 100,
  };
}

/** Prezzo da cui partire: pieno per default, promozione solo se scelta esplicitamente. */
export function lotPriceFor(displayed: number | null, sale: number | null, usePromo: boolean): number | null {
  if (usePromo && sale !== null && sale > 0) return sale;
  return displayed;
}
