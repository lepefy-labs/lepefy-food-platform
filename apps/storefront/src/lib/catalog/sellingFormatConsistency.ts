// Product editor: the selling format describes ONE unit sold at the product price,
// `weight_grams` is the shipping weight of that same unit. A format heavier than
// the shipping weight is impossible, and a format equal to minimum × weight is
// the classic mix-up (« 2 kg » written for a 1 kg unit sold by 2). Pure, mass
// units only (g, kg): a volume has no reliable weight. Advice, never a block.

import { formatContent, parseNetQuantity, resolveSellingFormat, type NetContent, type SellingFormatSource } from '../storefrontCopy/sellingFormat';

/** Above this ratio the format is considered heavier than the shipping weight (packaging lighter than 5 %). */
const TOLERANCE = 1.05;

function massGrams(content: NetContent | null, packCount: number | null): number | null {
  if (!content) return null;
  const grams = content.unit === 'kg' ? content.value * 1000 : content.unit === 'g' ? content.value : null;
  return grams == null ? null : grams * (packCount ?? 1);
}

function gramsLabel(grams: number): string {
  return formatContent(grams >= 1000 ? { value: grams / 1000, unit: 'kg' } : { value: grams, unit: 'g' });
}

export function sellingFormatWeightWarning(
  source: SellingFormatSource,
  weightGrams: number | null | undefined,
  minOrderQuantity: number | null | undefined,
): string | null {
  const weight = Number(weightGrams);
  if (!Number.isFinite(weight) || weight <= 0) return null;
  const minimum = Number.isInteger(minOrderQuantity) && (minOrderQuantity ?? 1) > 1 ? minOrderQuantity! : 1;
  const resolved = resolveSellingFormat(source);
  // What the customer sees, then the free label text when the structured fields say something else.
  const candidates = [
    { grams: massGrams(resolved.content, resolved.packCount), text: resolved.content ? formatContent(resolved.content) + (resolved.packCount ? ` × ${resolved.packCount}` : '') : '' },
    { grams: massGrams(parseNetQuantity(source.net_quantity_display), null), text: source.net_quantity_display?.trim() ?? '' },
  ];
  for (const { grams, text } of candidates) {
    if (grams == null || grams <= weight * TOLERANCE) continue;
    if (minimum > 1 && Math.abs(grams - weight * minimum) <= weight * minimum * (TOLERANCE - 1)) {
      return `« ${text} » correspond au minimum d’achat (${minimum} × ${gramsLabel(weight)}). Le format décrit une seule unité vendue à ce prix : indiquez « ${gramsLabel(grams / minimum)} ».`;
    }
    return `Le format (« ${text} ») pèse plus que le poids d’expédition d’une unité (${gramsLabel(weight)}). Le format décrit une unité vendue à ce prix, le poids sert aux frais de livraison : corrigez celui qui est faux.`;
  }
  return null;
}
