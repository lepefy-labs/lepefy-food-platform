/**
 * Format de vente affiché au client : « 8,50 € le paquet de 500 g, soit
 * 17,00 € le kilo ». Purement descriptif : rien ici ne modifie un prix, une
 * quantité achetable ou une règle de checkout.
 *
 * Résolution à trois niveaux, jamais à partir de `weight_grams` (poids
 * logistique, emballage compris) ni du nom du produit :
 *   1. structuré  — `sale_unit`, `net_content_value/unit`, `pack_count` (154) ;
 *   2. quantité nette — `net_quantity_display` uniquement s'il est exactement
 *      de la forme « 500 g », « 1,5 kg », « 33 cl », « 1 L » ;
 *   3. aucun     — « l'article ».
 */

import { formatPrice } from '../utils/format';
import { definiteArticle, getSaleUnit, unitNoun, type SaleUnit } from './saleUnits';

export type ContentUnit = 'g' | 'kg' | 'ml' | 'cl' | 'l';

export const CONTENT_UNITS: readonly ContentUnit[] = ['g', 'kg', 'ml', 'cl', 'l'];

export interface NetContent {
  value: number;
  unit: ContentUnit;
}

/** Champs produit lus par le formatter — tous facultatifs (anciens paniers, données partielles). */
export interface SellingFormatSource {
  net_quantity_display?: string | null;
  sale_unit?: string | null;
  net_content_value?: number | string | null;
  net_content_unit?: string | null;
  pack_count?: number | null;
}

export interface SellingFormat {
  source: 'structured' | 'net_quantity' | 'none';
  unit: SaleUnit | null;
  content: NetContent | null;
  packCount: number | null;
}

const NET_QUANTITY_PATTERN = /^\s*(\d+(?:[.,]\d+)?)\s?(g|kg|ml|cl|l)\s*$/i;

/** Lecture stricte d'une quantité nette libre ; tout ce qui n'est pas exactement « nombre + unité » est refusé. */
export function parseNetQuantity(text: string | null | undefined): NetContent | null {
  if (!text) return null;
  const match = NET_QUANTITY_PATTERN.exec(text);
  if (!match) return null;
  const value = Number(match[1]!.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, unit: match[2]!.toLowerCase() as ContentUnit };
}

function structuredContent(source: SellingFormatSource): NetContent | null {
  const value = source.net_content_value == null ? NaN : Number(source.net_content_value);
  const unit = source.net_content_unit?.toLowerCase();
  if (!Number.isFinite(value) || value <= 0 || !unit || !(CONTENT_UNITS as readonly string[]).includes(unit)) return null;
  return { value, unit: unit as ContentUnit };
}

function validPackCount(raw: number | null | undefined): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 2 ? raw : null;
}

/** Champs de format normalisés, transportables tels quels (panier, Nala, email). */
export interface SellingFormatFields {
  net_quantity_display: string | null;
  sale_unit: string | null;
  net_content_value: number | null;
  net_content_unit: string | null;
  pack_count: number | null;
}

/** Copie des seuls champs de format (ajout au panier, adaptateurs de cartes). */
export function pickSellingFormatFields(source: SellingFormatSource): SellingFormatFields {
  const value = source.net_content_value == null ? null : Number(source.net_content_value);
  return {
    net_quantity_display: source.net_quantity_display ?? null,
    sale_unit: source.sale_unit ?? null,
    net_content_value: value != null && Number.isFinite(value) ? value : null,
    net_content_unit: source.net_content_unit ?? null,
    pack_count: source.pack_count ?? null,
  };
}

export function resolveSellingFormat(source: SellingFormatSource | null | undefined): SellingFormat {
  if (!source) return { source: 'none', unit: null, content: null, packCount: null };
  const unit = getSaleUnit(source.sale_unit);
  if (unit) {
    return {
      source: 'structured',
      unit,
      content: unit.byWeight ? null : structuredContent(source) ?? parseNetQuantity(source.net_quantity_display),
      packCount: unit.byWeight ? null : validPackCount(source.pack_count),
    };
  }
  const content = parseNetQuantity(source.net_quantity_display);
  if (content) return { source: 'net_quantity', unit: null, content, packCount: null };
  return { source: 'none', unit: null, content: null, packCount: null };
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value);
}

/** 1000 g → 1 kg, 1500 ml → 1,5 L, 100 cl → 1 L : unité la plus lisible, même quantité. */
function readableContent(content: NetContent): NetContent {
  if (content.unit === 'g' && content.value >= 1000) return { value: content.value / 1000, unit: 'kg' };
  if (content.unit === 'ml' && content.value >= 1000) return { value: content.value / 1000, unit: 'l' };
  if (content.unit === 'cl' && content.value >= 100) return { value: content.value / 100, unit: 'l' };
  return content;
}

/** « 500 g », « 1,5 kg », « 33 cl », « 1 L ». */
export function formatContent(content: NetContent): string {
  const readable = readableContent(content);
  return `${formatNumber(readable.value)} ${readable.unit === 'l' ? 'L' : readable.unit}`;
}

function isExactlyOneBaseUnit(content: NetContent): boolean {
  const readable = readableContent(content);
  return readable.value === 1 && (readable.unit === 'kg' || readable.unit === 'l');
}

/** Complément du prix : « le paquet de 500 g », « les 500 g », « le kilo », « l'article ». */
export function unitPhrase(format: SellingFormat): string {
  const { unit, content, packCount } = format;
  if (unit?.byWeight) return 'le kilo';
  if (unit) {
    const base = definiteArticle(unit.singular, unit.feminine);
    if (packCount && content) return `${base} de ${packCount} × ${formatContent(content)}`;
    if (packCount) return `${base} de ${packCount}`;
    if (content) return `${base} de ${formatContent(content)}`;
    return base;
  }
  if (content) {
    if (isExactlyOneBaseUnit(content)) return readableContent(content).unit === 'kg' ? 'le kilo' : 'le litre';
    return `les ${formatContent(content)}`;
  }
  return "l'article";
}

/** Libellé court du contenu pour la fiche (« 500 g », « 12 × 33 cl ») ; null si inconnu. */
export function contentLabel(format: SellingFormat): string | null {
  if (format.packCount && format.content) return `${format.packCount} × ${formatContent(format.content)}`;
  if (format.content) return formatContent(format.content);
  if (format.packCount) return `${format.packCount} pièces`;
  return null;
}

/** Contenu total en kilos ou litres ; null hors masse/volume. */
function totalBaseQuantity(format: SellingFormat): { amount: number; per: 'kilo' | 'litre' } | null {
  const { content } = format;
  if (!content) return null;
  const count = format.packCount ?? 1;
  const factor: Record<ContentUnit, number> = { g: 0.001, kg: 1, ml: 0.001, cl: 0.01, l: 1 };
  const amount = content.value * factor[content.unit] * count;
  if (!(amount > 0)) return null;
  return { amount, per: content.unit === 'g' || content.unit === 'kg' ? 'kilo' : 'litre' };
}

/** « soit 17,00 € le kilo » — affichage seulement, arrondi au centime. */
export function referencePriceLine(price: number, format: SellingFormat, currency = 'EUR'): string | null {
  if (format.unit?.byWeight || !Number.isFinite(price) || price <= 0) return null;
  const base = totalBaseQuantity(format);
  if (!base || Math.abs(base.amount - 1) < 1e-9) return null;
  const perUnit = Math.round((price / base.amount) * 100) / 100;
  return `soit ${formatPrice(perUnit, currency)} ${base.per === 'kilo' ? 'le kilo' : 'le litre'}`;
}

/** Nom de l'unité pour une quantité (« 4 paquets ») ; null quand l'unité est inconnue. */
export function quantityNoun(format: SellingFormat, count: number): string | null {
  if (!format.unit || format.unit.byWeight) return null;
  return unitNoun(format.unit, count);
}

/** « 4 paquets », ou « 4 » quand l'unité n'est pas connue. */
export function formatCount(format: SellingFormat, count: number): string {
  const noun = quantityNoun(format, count);
  return noun ? `${count} ${noun}` : String(count);
}

export interface PriceDisplay {
  amount: string;
  unitPhrase: string;
  reference: string | null;
  /** Phrase complète pour les lecteurs d'écran et les canaux texte. */
  sentence: string;
}

export function describePrice(price: number, format: SellingFormat, currency = 'EUR'): PriceDisplay {
  const amount = formatPrice(price, currency);
  const phrase = unitPhrase(format);
  const reference = referencePriceLine(price, format, currency);
  return {
    amount,
    unitPhrase: phrase,
    reference,
    sentence: `${amount} ${phrase}${reference ? `, ${reference}` : ''}`,
  };
}

/**
 * Détail d'une ligne de commande : « 3 sachets de 150 g · 3,00 € le sachet »,
 * « 2 × 1,80 € l'article ». `price` est le prix unitaire enregistré, jamais recalculé.
 */
export function orderLineDetail(price: number, quantity: number, format: SellingFormat, currency = 'EUR'): string {
  const amount = formatPrice(price, currency);
  const { unit } = format;
  if (unit && !unit.byWeight) {
    const content = contentLabel(format);
    const counted = formatCount(format, quantity);
    return `${counted}${content ? ` de ${content}` : ''} · ${amount} ${definiteArticle(unit.singular, unit.feminine)}`;
  }
  return `${quantity} × ${amount} ${unitPhrase(format)}`;
}
