/**
 * Formats de vente sous une seule fiche (migration 187, docs/PRODUCT_SALE_FORMATS.md).
 *
 * Moteur pur, partagé par le serveur (checkout) et le client (fiche, card,
 * panier). Trois nombres restent distincts : le format choisi, la quantité
 * achetée (lignes du panier) et les unités physiques (quantité × unités par
 * vente). En stock partagé, l'unité de base est celle du stock du parent.
 * Aucune logique propre à un produit : un format = une ligne `products` avec
 * `format_parent_id`, `units_per_sale`, `format_label`.
 */
import { computeQuantityRuleState, getMaximumValidQuantity } from '@/lib/purchaseQuantityRules';

export type FormatStockMode = 'shared' | 'own';

/** Champs de format d'une ligne `products` (tous facultatifs : paniers anciens). */
export interface SaleFormatFields {
  format_parent_id?: string | null;
  units_per_sale?: number | null;
  format_label?: string | null;
  format_position?: number | null;
  format_stock_mode?: FormatStockMode | string | null;
}

/** Un format enfant tel que lu par la projection des cards (`formats:products!…`). */
export interface SaleFormatRow extends SaleFormatFields {
  id: string;
  slug?: string;
  name?: string;
  price: number;
  compare_at_price?: number | null;
  stock: number | null;
  active?: boolean | null;
  min_order_quantity?: number | null;
  order_quantity_step?: number | null;
  weight_grams?: number | null;
  promo_applied?: boolean | null;
  promo_ends_at?: string | null;
  promo_until_sold_out?: boolean | null;
}

/** Fiche canonique avec ses formats enfants (absent / vide = format unique). */
export interface SaleFormatParent extends SaleFormatRow {
  formats?: SaleFormatRow[] | null;
}

export interface SaleFormatOption {
  id: string;
  /** Ligne `products` à ajouter au panier (la fiche elle-même pour la base). */
  row: SaleFormatRow;
  label: string;
  units: number;
  isBase: boolean;
  price: number;
  compareAtPrice: number | null;
  /** Prix par unité de base, null si le format n'en contient qu'une. */
  unitPrice: number | null;
  /** Économie (euros) par rapport à `units` unités de base au prix effectif de la base ; 0 si aucune. */
  savings: number;
  minimum: number;
  step: number;
  /** Stock de CE format (dérivé du parent en stock partagé). */
  stock: number;
  /** Quantité maximale achetable de CE format, stock dérivé compris. */
  maxPurchasable: number;
  purchasable: boolean;
}

const roundCents = (value: number): number => Math.round(value * 100) / 100;

export function unitsPerSale(row: SaleFormatFields | null | undefined): number {
  const units = Math.trunc(Number(row?.units_per_sale ?? 1));
  return Number.isFinite(units) && units >= 1 ? units : 1;
}

/** Ligne enfant d'une fiche (jamais une card ni un résultat de recherche). */
export function isFormatChild(row: SaleFormatFields | null | undefined): boolean {
  return Boolean(row?.format_parent_id);
}

/** Libellé du format, ou null pour un produit à format unique. */
export function formatLabelOf(row: SaleFormatFields | null | undefined): string | null {
  const label = row?.format_label?.trim();
  return label ? label : null;
}

/** Stock qui fait foi pour cette ligne : le parent en stock partagé, sinon elle-même. */
export function stockSourceId(row: SaleFormatFields & { id: string }): string {
  if (row.format_parent_id && (row.format_stock_mode ?? 'shared') === 'shared') return row.format_parent_id;
  return row.id;
}

/** Unités de base consommées par une ligne achetée `quantity` fois. */
export function baseUnitsFor(row: SaleFormatFields & { id: string }, quantity: number): number {
  return stockSourceId(row) === row.id ? quantity : quantity * unitsPerSale(row);
}

/**
 * Économie d'un format face à `units` unités de base au prix effectif de la
 * base (promotions comprises : `price` est toujours le prix payé). Positive
 * seulement ; 0 = ne rien afficher.
 */
export function formatSavings(basePrice: number, units: number, formatPrice: number): number {
  if (!(basePrice > 0) || !(formatPrice > 0) || units <= 1) return 0;
  const saving = roundCents(basePrice * units - formatPrice);
  return saving >= 0.01 ? saving : 0;
}

/**
 * Formats achetables d'une fiche, base en premier puis ordre admin. Tableau
 * vide quand la fiche n'a aucun format enfant actif : le produit garde
 * exactement son comportement à format unique.
 */
export function buildSaleFormatOptions(product: SaleFormatParent): SaleFormatOption[] {
  const children = (product.formats ?? [])
    .filter((row) => row && row.active !== false && unitsPerSale(row) > 1 && formatLabelOf(row))
    .sort((a, b) => (a.format_position ?? 0) - (b.format_position ?? 0) || unitsPerSale(a) - unitsPerSale(b));
  if (children.length === 0) return [];

  const baseStock = Math.max(0, Math.trunc(Number(product.stock ?? 0)));
  const toOption = (row: SaleFormatRow, isBase: boolean): SaleFormatOption => {
    const units = isBase ? 1 : unitsPerSale(row);
    const minimum = Math.max(1, Math.trunc(Number(row.min_order_quantity ?? 1)) || 1);
    const step = Math.max(1, Math.trunc(Number(row.order_quantity_step ?? 1)) || 1);
    const ownStock = Math.max(0, Math.trunc(Number(row.stock ?? 0)));
    const stock = isBase || (row.format_stock_mode ?? 'shared') !== 'shared'
      ? ownStock
      : Math.floor(baseStock / units);
    const maxPurchasable = getMaximumValidQuantity(stock, minimum, step);
    return {
      id: row.id,
      row,
      label: formatLabelOf(row) ?? (isBase ? '1 article' : `Lot de ${units}`),
      units,
      isBase,
      price: Number(row.price),
      compareAtPrice: row.compare_at_price ?? null,
      unitPrice: units > 1 ? roundCents(Number(row.price) / units) : null,
      savings: isBase ? 0 : formatSavings(Number(product.price), units, Number(row.price)),
      minimum,
      step,
      stock,
      maxPurchasable,
      purchasable: maxPurchasable > 0,
    };
  };
  return [toOption(product, true), ...children.map((row) => toOption(row, false))];
}

/** Lowest price per base unit among purchasable formats (« dès 3,30 € »). */
export function lowestUnitPrice(options: SaleFormatOption[]): number | null {
  const prices = options.filter((o) => o.purchasable).map((o) => o.unitPrice ?? o.price);
  return prices.length ? Math.min(...prices) : null;
}

export interface StockDemandLine {
  productId: string;
  quantity: number;
  row: SaleFormatFields & { id: string };
}

/** Unités de base demandées par stock qui fait foi (parent en stock partagé). */
export function aggregateStockDemand(lines: StockDemandLine[]): Map<string, number> {
  const demand = new Map<string, number>();
  for (const line of lines) {
    const source = stockSourceId(line.row);
    demand.set(source, (demand.get(source) ?? 0) + baseUnitsFor(line.row, line.quantity));
  }
  return demand;
}

/** Ligne de panier minimale lue par la proposition de passage au lot. */
export interface SwapCartLine {
  productId: string;
  quantity: number;
  price: number;
  minimum: number;
  step: number;
}

export interface FormatSwapProposal {
  baseId: string;
  formatId: string;
  /** Nouvelle quantité de la base (0 = ligne retirée). */
  baseQuantity: number;
  /** Lots ajoutés. */
  formatQuantity: number;
  label: string;
  units: number;
  /** Économie totale (euros) sur ce passage. */
  savings: number;
}

/**
 * « Passer au lot et économiser X € » : seulement si le format est actif,
 * achetable pour la quantité proposée (stock dérivé compris), moins cher que
 * les unités qu'il remplace, et si ce qui reste de la base respecte encore sa
 * règle. Les unités physiques restent identiques. Choisit l'économie la plus
 * grande ; null = ne rien proposer.
 */
export function proposeFormatSwap(
  base: SwapCartLine,
  options: SaleFormatOption[],
  formatLines: ReadonlyMap<string, number>,
): FormatSwapProposal | null {
  if (base.quantity <= 0 || options.length === 0) return null;
  let best: FormatSwapProposal | null = null;
  for (const option of options) {
    if (option.isBase || !option.purchasable) continue;
    const perLotSaving = formatSavings(base.price, option.units, option.price);
    if (perLotSaving <= 0) continue;
    const inCart = formatLines.get(option.id) ?? 0;
    for (let lots = Math.floor(base.quantity / option.units); lots >= 1; lots -= 1) {
      const total = inCart + lots;
      if (computeQuantityRuleState(total, option.minimum, option.step).nextValidQuantity !== total) continue;
      // Stock partagé : les unités physiques ne changent pas ; le lot doit seulement tenir dans son stock dérivé.
      if (total > option.maxPurchasable) continue;
      const remaining = base.quantity - lots * option.units;
      if (remaining > 0 && computeQuantityRuleState(remaining, base.minimum, base.step).nextValidQuantity !== remaining) continue;
      const savings = roundCents(perLotSaving * lots);
      if (!best || savings > best.savings) {
        best = {
          baseId: base.productId,
          formatId: option.id,
          baseQuantity: remaining,
          formatQuantity: lots,
          label: option.label,
          units: option.units,
          savings,
        };
      }
      break;
    }
  }
  return best;
}

/** « 1 lot de 3 paquets », « 2 paquets » : quantité + libellé du format, sans ambiguïté. */
export function formatQuantityLabel(label: string, quantity: number): string {
  const trimmed = label.trim();
  // « 1 paquet » × 2 → « 2 paquets » ; « Lot de 3 paquets » × 2 → « 2 lots de 3 paquets ».
  const leadingOne = /^1\s+(.+)$/.exec(trimmed);
  if (leadingOne) return quantity === 1 ? trimmed : `${quantity} ${pluralizeFirst(leadingOne[1]!)}`;
  const lowered = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
  return quantity === 1 ? `1 ${lowered}` : `${quantity} ${pluralizeFirst(lowered)}`;
}

function pluralizeFirst(text: string): string {
  const [first, ...rest] = text.split(' ');
  if (!first) return text;
  const plural = /[sxz]$/i.test(first) ? first : /eau$|au$/i.test(first) ? `${first}x` : `${first}s`;
  return [plural, ...rest].join(' ');
}
