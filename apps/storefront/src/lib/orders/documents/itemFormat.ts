import {
  CONTENT_UNITS, contentLabel, formatCount, parseNetQuantity, resolveSellingFormat,
  type ContentUnit, type NetContent, type SellingFormat, type SellingFormatSource,
} from '@/lib/storefrontCopy/sellingFormat';

/**
 * Format réellement acheté, imprimé sur le récapitulatif client
 * (« Format : 500 g »). Seule source : `order_items.format_snapshot`
 * (migration 162), figé à l'insertion de la ligne de commande à partir de la
 * fiche produit — jamais le catalogue actuel, jamais `products.weight_grams`
 * (poids logistique), jamais une déduction depuis le nom. Une ligne sans
 * snapshot (commande antérieure à la 162, produit renommé entre le panier et
 * la commande, fiche sans format) n'affiche rien : comportement historique.
 */

/**
 * Snapshot persisté : v1 = champs de format de la fiche (154 + 018) ; v2 (187)
 * ajoute le format de vente acheté (libellé, unités de base par vente, stock
 * qui fait foi). Les champs de format d'un lot décrivent son unité de base.
 */
export interface OrderItemFormatSnapshot extends SellingFormatSource {
  v: 1 | 2;
  format_label?: string | null;
  units_per_sale?: number | null;
  stock_product_id?: string | null;
}

const MAX_TEXT_LENGTH = 40;

export function parseFormatSnapshot(raw: unknown): OrderItemFormatSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.v !== 1 && value.v !== 2) return null;
  // v2 (187) est toujours écrit avec le libellé du format : sans lui, snapshot non fiable.
  if (value.v === 2 && (typeof value.format_label !== 'string' || !value.format_label.trim())) return null;
  const text = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : null);
  const num = (key: string) => (typeof value[key] === 'number' || typeof value[key] === 'string' ? Number(value[key]) : null);
  const pack = num('pack_count');
  const units = num('units_per_sale');
  return {
    v: value.v,
    format_label: value.v === 2 ? text('format_label')?.slice(0, 60) ?? null : null,
    units_per_sale: value.v === 2 && units != null && Number.isInteger(units) && units >= 1 ? units : null,
    stock_product_id: value.v === 2 ? text('stock_product_id') : null,
    sale_unit: text('sale_unit'),
    net_content_value: num('net_content_value'),
    net_content_unit: text('net_content_unit'),
    pack_count: pack != null && Number.isInteger(pack) ? pack : null,
    net_quantity_display: text('net_quantity_display'),
  };
}

const TO_BASE: Record<NetContent['unit'], { dimension: 'mass' | 'volume'; factor: number }> = {
  g: { dimension: 'mass', factor: 1 },
  kg: { dimension: 'mass', factor: 1000 },
  ml: { dimension: 'volume', factor: 1 },
  cl: { dimension: 'volume', factor: 10 },
  l: { dimension: 'volume', factor: 1000 },
};

const NAME_QUANTITY = /(\d+(?:[.,]\d+)?)\s*(kg|g|gr|grammes?|ml|cl|l|litres?)(?![a-zà-ÿ])/gi;

function nameUnit(raw: string): NetContent['unit'] {
  const unit = raw.toLowerCase();
  if (unit === 'gr' || unit.startsWith('gramme')) return 'g';
  if (unit.startsWith('litre')) return 'l';
  return unit as NetContent['unit'];
}

/** Le nom contient-il déjà ce contenu (« Kaolin 500g », « Huile 1 L » pour 1000 ml) ? */
function nameHasContent(name: string, content: NetContent): boolean {
  const target = TO_BASE[content.unit];
  const targetBase = content.value * target.factor;
  for (const match of name.matchAll(NAME_QUANTITY)) {
    const unit = TO_BASE[nameUnit(match[2]!)];
    const base = Number(match[1]!.replace(',', '.')) * unit.factor;
    if (unit.dimension === target.dimension && Math.abs(base - targetBase) < 1e-6) return true;
  }
  return false;
}

/**
 * Le storefront n'utilise le contenu structuré qu'avec une unité de vente ;
 * sur un document, un contenu net figé sans unité (« 500 g ») reste un format
 * sûr à afficher.
 */
function withStructuredContent(format: SellingFormat, snapshot: OrderItemFormatSnapshot): SellingFormat {
  if (format.content || format.unit?.byWeight) return format;
  const value = snapshot.net_content_value == null ? NaN : Number(snapshot.net_content_value);
  const unit = snapshot.net_content_unit?.toLowerCase();
  if (!Number.isFinite(value) || value <= 0 || !unit || !(CONTENT_UNITS as readonly string[]).includes(unit)) return format;
  return { ...format, content: { value, unit: unit as ContentUnit } };
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s×]+/g, '');
}

/**
 * Libellé court du format acheté (« 500 g », « 1,5 L », « 12 × 33 cl »,
 * « Vendu au kilo », ou la quantité nette textuelle de la fiche), ou `null`
 * s'il n'y a pas de snapshot fiable ou si le nom de l'article le contient déjà.
 */
export function orderItemFormatLabel(snapshotRaw: unknown, itemName: string): string | null {
  const snapshot = parseFormatSnapshot(snapshotRaw);
  if (!snapshot) return null;
  if (snapshot.format_label) return saleFormatLine(snapshot, itemName);
  return baseFormatLabel(snapshot, itemName);
}

/**
 * Format de vente acheté (187) : « 1 paquet · 500 g », « Lot de 3 paquets » +
 * « 3 × 500 g ». Le libellé n'est pas répété s'il est déjà dans le nom.
 */
function saleFormatLine(snapshot: OrderItemFormatSnapshot, itemName: string): string | null {
  const label = snapshot.format_label!;
  const units = snapshot.units_per_sale ?? 1;
  const base = baseFormatLabel({ ...snapshot, format_label: null }, itemName.replace(label, ''));
  const content = base && units > 1 ? `${units} × ${base}` : base;
  const parts = [normalize(itemName).includes(normalize(label)) ? null : label, content].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Unités physiques à préparer pour une ligne d'un format de plusieurs unités
 * (« 6 paquets » pour 2 × « Lot de 3 paquets ») ; null sinon. Même source
 * (snapshot) : jamais le catalogue actuel.
 */
export function orderItemPhysicalUnits(snapshotRaw: unknown, quantity: number): string | null {
  const snapshot = parseFormatSnapshot(snapshotRaw);
  const units = snapshot?.units_per_sale ?? 1;
  if (!snapshot || units <= 1 || !Number.isInteger(quantity) || quantity < 1) return null;
  const total = units * quantity;
  const format = resolveSellingFormat(snapshot);
  return format.unit && !format.unit.byWeight ? formatCount(format, total) : `${total} unités`;
}

function baseFormatLabel(snapshot: OrderItemFormatSnapshot, itemName: string): string | null {
  const format = withStructuredContent(resolveSellingFormat(snapshot), snapshot);

  if (format.unit?.byWeight) return /\bkg\b|kilo/i.test(itemName) ? null : 'Vendu au kilo';

  const structured = contentLabel(format);
  if (structured) {
    if (format.content && nameHasContent(itemName, format.content)) {
      if (!format.packCount) return null;
      if (new RegExp(`(^|\\D)${format.packCount}\\s*(x|×|\\*|pi[eè]ces?|unit|bouteilles?|canettes?)|(x|×)\\s*${format.packCount}(\\D|$)`, 'i').test(itemName)) return null;
    }
    return structured;
  }

  const text = snapshot.net_quantity_display?.replace(/\s+/g, ' ').trim();
  if (!text || text.length > MAX_TEXT_LENGTH) return null;
  const parsed = parseNetQuantity(text);
  if (parsed && nameHasContent(itemName, parsed)) return null;
  if (normalize(itemName).includes(normalize(text))) return null;
  return text;
}
