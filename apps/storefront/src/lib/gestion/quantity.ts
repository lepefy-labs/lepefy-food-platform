/**
 * Aritmetica decimale esatta per le quantità Gestion (pura, server e client).
 *
 * Le quantità d'acquisto hanno al massimo 3 decimali (numeric(14,3)), le
 * conversioni verso lo stock al massimo 6 (numeric(14,6)). Qui si lavora in
 * interi scalati (BigInt): nessun float JS per remaining, "tout le reste",
 * anteprima d'impatto stock o validazione. Il DB resta l'autorità finale.
 */

export const QUANTITY_SCALE = 3;
export const CONVERSION_SCALE = 6;

const pow10 = (n: number) => BigInt(10) ** BigInt(n);

/**
 * "12,5" | "12.5" | 12.5 -> intero scalato (12500 per scale 3).
 * null se non numerico, negativo o con più decimali della scala (mai arrotondato).
 */
export function parseScaled(input: string | number | null | undefined, scale: number): bigint | null {
  if (input === null || input === undefined) return null;
  const raw = (typeof input === 'number' ? (Number.isFinite(input) ? String(input) : '') : input).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  if (trimmed.length > scale) return null;
  return BigInt(whole ?? '0') * pow10(scale) + BigInt((trimmed + '0'.repeat(scale)).slice(0, scale) || '0');
}

export const parseQuantity = (input: string | number | null | undefined) => parseScaled(input, QUANTITY_SCALE);
export const parseConversion = (input: string | number | null | undefined) => parseScaled(input, CONVERSION_SCALE);

/** Intero scalato -> stringa canonica con punto, senza zeri finali ("12.5"). */
export function scaledToString(value: bigint, scale: number): string {
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const base = pow10(scale);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(scale, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export const quantityToString = (value: bigint) => scaledToString(value, QUANTITY_SCALE);

/** Quantità canonica ("12.5") da inviare alle API, o null se invalida. */
export function canonicalQuantity(input: string | number | null | undefined): string | null {
  const parsed = parseQuantity(input);
  return parsed === null ? null : quantityToString(parsed);
}

export function canonicalConversion(input: string | number | null | undefined): string | null {
  const parsed = parseConversion(input);
  return parsed === null || parsed === BigInt(0) ? null : scaledToString(parsed, CONVERSION_SCALE);
}

export interface StockConversion {
  /** Unità di stock risultanti (troncate) e se il risultato è esattamente intero. */
  units: bigint;
  exact: boolean;
}

/** quantità d'acquisto × conversione: stessa regola della RPC (risultato intero o rifiuto). */
export function stockUnitsFor(quantity: bigint, conversion: bigint): StockConversion {
  const product = quantity * conversion; // scala 3 + 6 = 9
  const base = pow10(QUANTITY_SCALE + CONVERSION_SCALE);
  return { units: product / base, exact: product % base === BigInt(0) };
}

/** Residuo da ricevere, mai negativo. */
export function remainingQuantity(ordered: bigint, received: bigint): bigint {
  return ordered > received ? ordered - received : BigInt(0);
}

/**
 * Costo per unità di stock = costo per unità d'acquisto / conversione,
 * arrotondato a 4 decimali (half-up), come round(…, 4) in SQL.
 */
export function costPerStockUnit(purchaseUnitCost: string | number, conversion: string | number): string | null {
  const cost = parseScaled(purchaseUnitCost, 4);
  const factor = parseConversion(conversion);
  if (cost === null || factor === null || factor === BigInt(0)) return null;
  // cost (scala 4) / factor (scala 6) -> risultato scala 4: cost * 10^6 / factor, half-up.
  const numerator = cost * pow10(CONVERSION_SCALE) * BigInt(2);
  const doubled = numerator / factor;
  const rounded = (doubled + BigInt(1)) / BigInt(2);
  return scaledToString(rounded, 4);
}
