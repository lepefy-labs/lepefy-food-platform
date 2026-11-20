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

/** Une ligne du plan : format et quantité achetée de ce format. */
export interface FormatPlanLine {
  option: SaleFormatOption;
  quantity: number;
}

export interface FormatBundlePlan {
  /** Unités de base au total (ce que montre le compteur). */
  units: number;
  /** Lignes du panier, base en premier ; jamais de quantité 0. */
  lines: FormatPlanLine[];
  /** Total payé (somme des prix effectifs). */
  total: number;
  /** Économie par rapport à `units` unités de base au prix de la base ; 0 si aucune. */
  savings: number;
}

/**
 * Regroupement automatique (migration 187, v2) : le client compte en unités
 * de base (« 4 paquets ») et le panier choisit la combinaison la moins chère
 * de formats (1 lot de 3 + 1 paquet). Programmation dynamique bornée : marche
 * avec plusieurs tailles de lot (3 et 12), respecte le maximum achetable et
 * la règle minimum/pas de chaque format. À coût égal, la base l'emporte : un
 * lot qui ne fait rien économiser n'est jamais imposé. null = impossible
 * (stock ou règles).
 */
export function planFormatBundle(units: number, options: SaleFormatOption[]): FormatBundlePlan | null {
  const target = Math.max(0, Math.trunc(units));
  if (options.length === 0) return null;
  if (target === 0) return { units: 0, lines: [], total: 0, savings: 0 };
  // Base d'abord : à coût égal, la combinaison trouvée en premier (singles) est gardée.
  const ordered = [...options].sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.units - b.units);
  const cents = (value: number) => Math.round(value * 100);
  let best: Array<{ cost: number; counts: number[] } | null> = Array.from({ length: target + 1 }, () => null);
  best[0] = { cost: 0, counts: ordered.map(() => 0) };
  ordered.forEach((option, index) => {
    const next = best.slice();
    const allowed: number[] = [];
    const maxCount = Math.min(option.maxPurchasable, Math.floor(target / option.units));
    for (let count = 1; count <= maxCount; count += 1) {
      if (computeQuantityRuleState(count, option.minimum, option.step).nextValidQuantity === count) allowed.push(count);
    }
    for (let total = 0; total <= target; total += 1) {
      const from = best[total];
      if (!from) continue;
      for (const count of allowed) {
        const reach = total + count * option.units;
        if (reach > target) break;
        const cost = from.cost + cents(option.price) * count;
        const current = next[reach];
        if (!current || cost < current.cost) {
          const counts = from.counts.slice();
          counts[index] = count;
          next[reach] = { cost, counts };
        }
      }
    }
    best = next;
  });
  const result = best[target];
  if (!result) return null;
  const lines = ordered
    .map((option, index) => ({ option, quantity: result.counts[index]! }))
    .filter((line) => line.quantity > 0);
  const base = options.find((option) => option.isBase);
  const total = result.cost / 100;
  const savings = base ? Math.max(0, roundCents(base.price * target - total)) : 0;
  return { units: target, lines, total, savings: savings >= 0.01 ? savings : 0 };
}

/** Plus grand nombre d'unités de base qu'un plan peut servir (stock et règles compris). */
export function maxBundleUnits(options: SaleFormatOption[], ceiling = 999): number {
  const base = options.find((option) => option.isBase);
  let candidate = Math.min(ceiling, options.reduce((sum, option) => sum + option.maxPurchasable * option.units, 0));
  if (base && options.every((option) => option.isBase || (option.row.format_stock_mode ?? 'shared') === 'shared')) {
    candidate = Math.min(candidate, Math.max(0, base.stock));
  }
  while (candidate > 0 && !planFormatBundle(candidate, options)) candidate -= 1;
  return candidate;
}

/** Quelques unités de plus pour payer moins (ou autant) que la composition actuelle. */
export interface CheaperWithMore {
  /** Unités de base à ajouter (au moins 1). */
  extra: number;
  /** Nouveau total d'unités de base. */
  units: number;
  /** Total payé avec ces unités (≤ total actuel). */
  total: number;
}

/**
 * Le regroupement peut rendre une unité de MOINS plus chère : 50 paquets =
 * 2 cartons de 20 + 1 carton de 10 (117,70 €), 49 paquets = 2 cartons + 9
 * paquets (118,80 €). Cherche le plus petit ajout (jusqu'à la taille du plus
 * grand format) qui coûte au plus le total actuel, dans la limite achetable.
 * null quand rien de tel n'existe : jamais d'incitation qui ferait payer plus.
 */
export function cheaperWithMoreUnits(units: number, currentTotal: number, options: SaleFormatOption[], maxUnits: number): CheaperWithMore | null {
  if (units <= 0 || options.length < 2) return null;
  const lookahead = Math.max(...options.map((option) => option.units)) - 1;
  const ceiling = Math.min(maxUnits, units + lookahead);
  for (let target = units + 1; target <= ceiling; target += 1) {
    const plan = planFormatBundle(target, options);
    if (plan && Math.round(plan.total * 100) <= Math.round(currentTotal * 100)) {
      return { extra: target - units, units: target, total: plan.total };
    }
  }
  return null;
}

/** « 1 lot de 3 + 1 paquet » : composition lisible d'un plan. */
export function describeBundle(plan: FormatBundlePlan): string {
  // Les lots d'abord (« 1 lot de 3 paquets + 1 paquet »), du plus grand au plus petit.
  return [...plan.lines]
    .sort((a, b) => b.option.units - a.option.units)
    .map((line) => formatQuantityLabel(line.option.label, line.quantity)).join(' + ');
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
