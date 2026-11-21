import { formatQuantityLabel, type CheaperWithMore, type DecrementPriceRise, type FormatBundlePlan, type SaleFormatOption } from '@/lib/catalog/saleFormats';
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

/**
 * Économie d'un format, avec UN seul prix de référence par option :
 * - prix barré (promotion) : « Économisez 14,00 € », calculé sur ce prix barré
 *   affiché juste à côté (59,90 € → 45,90 €) ;
 * - sinon, un lot face aux unités : « Économisez 0,60 € par rapport à 3
 *   paquets à l’unité ».
 * Jamais les deux : deux références voisines (59,90 € et 60,00 €) faisaient
 * paraître le calcul faux. null quand rien n'est économisé.
 */
export function saleFormatSavingsLine(option: SaleFormatOption, base: SellingFormat, currency = 'EUR'): string | null {
  const compareAt = option.compareAtPrice;
  if (compareAt != null && compareAt > option.price) {
    const saving = Math.round((compareAt - option.price) * 100) / 100;
    return saving >= 0.01 ? `Économisez ${formatPrice(saving, currency)}` : null;
  }
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

/** Lot le plus avantageux en vente (prix par unité le plus bas, économie positive). */
function bestOffer(options: SaleFormatOption[]): SaleFormatOption | null {
  return options
    .filter((option) => !option.isBase && option.purchasable && option.savings > 0)
    .sort((a, b) => (a.unitPrice ?? a.price) - (b.unitPrice ?? b.price))[0] ?? null;
}

/** « 3 pour 10,00 € » : l'offre lot sous le prix unitaire (card, fiche) ; null sans lot avantageux. */
export function saleFormatOfferLine(options: SaleFormatOption[], currency = 'EUR'): string | null {
  const offer = bestOffer(options);
  return offer ? `${offer.units} pour ${formatPrice(offer.price, currency)}` : null;
}

/**
 * Sous le compteur en unités : « dont 1 lot de 3 paquets · −0,50 € » quand un
 * lot est appliqué, sinon « Encore 1 paquet : les 3 à 10,00 € », sinon
 * « dans le panier ». Jamais d'action demandée au client.
 */
export function bundleCaption(plan: FormatBundlePlan | null, options: SaleFormatOption[], base: SellingFormat, currency = 'EUR'): string {
  if (!plan || plan.units === 0) return 'dans le panier';
  const lots = plan.lines.filter((line) => !line.option.isBase);
  if (lots.length > 0) {
    const text = lots.map((line) => formatQuantityLabel(line.option.label, line.quantity)).join(' + ');
    return plan.savings > 0 ? `dont ${text} · −${formatPrice(plan.savings, currency)}` : `dont ${text}`;
  }
  const offer = bestOffer(options);
  if (offer && plan.units < offer.units) {
    const missing = offer.units - plan.units;
    return `Encore ${formatCount(base, missing)} : les ${offer.units} à ${formatPrice(offer.price, currency)}`;
  }
  return 'dans le panier';
}

/**
 * « Avec 1 paquet de plus : 117,70 € au lieu de 118,80 € » (même prix :
 * « … pour le même prix »). Le client garde la main : le bouton propose
 * « Passer à 50 paquets », rien n'est ajouté tout seul.
 */
export function cheaperWithMoreLine(hint: CheaperWithMore, currentTotal: number, base: SellingFormat, currency = 'EUR'): string {
  const extra = formatCount(base, hint.extra);
  return Math.round(hint.total * 100) < Math.round(currentTotal * 100)
    ? `Avec ${extra} de plus : ${formatPrice(hint.total, currency)} au lieu de ${formatPrice(currentTotal, currency)}`
    : `Avec ${extra} de plus : même prix, ${formatPrice(hint.total, currency)}`;
}

/**
 * Avis avant un « − » qui ferait payer plus (on perd un lot) :
 * « À 9 paquets, vous paieriez 27,00 € au lieu de 25,90 €, soit 1,10 € de plus. »
 */
export function decrementPriceRiseLine(rise: DecrementPriceRise, base: SellingFormat, currency = 'EUR'): string {
  return `À ${formatCount(base, rise.units)}, vous paieriez ${formatPrice(rise.total, currency)} au lieu de ${formatPrice(rise.currentTotal, currency)}, soit ${formatPrice(rise.extra, currency)} de plus.`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
