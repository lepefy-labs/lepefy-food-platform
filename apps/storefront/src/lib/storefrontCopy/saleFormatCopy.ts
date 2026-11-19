import type { SaleFormatOption } from '@/lib/catalog/saleFormats';
import { formatPrice } from '@/lib/utils/format';
import { formatCount, unitPhrase, type SellingFormat } from './sellingFormat';

/**
 * Textes des formats de vente (migration 187). Le format de vente de la fiche
 * (154 : « paquet », « 500 g ») décrit l'unité de base ; un lot s'exprime en
 * unités de base. Sans unité structurée : « l'unité » / « N à l'unité ».
 */

/** « 3,30 € le paquet » pour un format de plusieurs unités ; null sinon. */
export function saleFormatUnitPriceLine(option: SaleFormatOption, base: SellingFormat, currency = 'EUR'): string | null {
  if (option.unitPrice == null) return null;
  const phrase = base.unit && !base.unit.byWeight ? unitPhrase(base) : "l'unité";
  return `${formatPrice(option.unitPrice, currency)} ${phrase}`;
}

/** « Économisez 0,60 € par rapport à 3 paquets à l’unité » — seulement si l'économie est positive. */
export function saleFormatSavingsLine(option: SaleFormatOption, base: SellingFormat, currency = 'EUR'): string | null {
  if (option.isBase || option.savings <= 0) return null;
  return `Économisez ${formatPrice(option.savings, currency)} par rapport à ${formatCount(base, option.units)} à l’unité`;
}

/** Chip de la card : « 2 formats · lot de 3 paquets à 9,90 € ». */
export function saleFormatCardChip(options: SaleFormatOption[], currency = 'EUR'): string {
  const others = options.filter((option) => !option.isBase && option.purchasable);
  if (others.length === 0) {
    const soldOut = options.find((option) => !option.isBase);
    return soldOut ? `${lowerFirst(soldOut.label)} épuisé` : `${options.length} formats`;
  }
  const first = others[0]!;
  return `${options.length} formats · ${lowerFirst(first.label)} à ${formatPrice(first.price, currency)}`;
}

/** « Passer au lot et économiser 0,60 € ». */
export function formatSwapTitle(savings: number, currency = 'EUR'): string {
  return `Passer au lot et économiser ${formatPrice(savings, currency)}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
