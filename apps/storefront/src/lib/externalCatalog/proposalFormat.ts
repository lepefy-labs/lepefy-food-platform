import type { NormalizedExternalProduct, UnitFormat } from './types';

/** Funzioni pure (anche lato client): formato, peso e valori proposti per il prodotto Lepefy. */

/** Peso unitario in grammi, solo se il formato è un peso (mai da un volume). */
export function unitWeightGrams(format: UnitFormat | null): number | null {
  if (!format || format.value === null) return null;
  if (format.unit === 'g') return Math.round(format.value);
  if (format.unit === 'kg') return Math.round(format.value * 1000);
  return null;
}

const UNIT_LABEL: Record<UnitFormat['unit'], string> = { g: 'g', kg: 'kg', ml: 'ml', cl: 'cl', l: 'L', unit: '' };

/** Quantità nette in etichetta ("500 g", "1,5 L"); null per unità senza misura. */
export function netQuantityDisplay(format: UnitFormat | null): string | null {
  if (!format || format.value === null || format.unit === 'unit') return null;
  return `${String(format.value).replace('.', ',')} ${UNIT_LABEL[format.unit]}`;
}

/**
 * Valori proposti per il prodotto Lepefy, prima di ogni decisione dell'admin.
 * Il prezzo NON è qui: dipende da minimo, sconto e arrotondamento scelti in UI
 * (`computeUnitPrice`).
 */
export interface ExternalProductProposal {
  name: string | null;
  description: string | null;
  min_order_quantity: number;
  order_quantity_step: number;
  weight_grams: number | null;
  net_quantity_display: string | null;
}

export function proposalFor(n: NormalizedExternalProduct): ExternalProductProposal {
  return {
    name: n.normalized_name,
    description: n.original_description,
    min_order_quantity: n.suggested_min_quantity ?? 1,
    order_quantity_step: n.suggested_quantity_step ?? 1,
    weight_grams: unitWeightGrams(n.unit_format),
    net_quantity_display: netQuantityDisplay(n.unit_format),
  };
}
