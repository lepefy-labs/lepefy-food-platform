import { formatDocumentDate, orderShortRef } from '@/lib/orders/documents/documentHtml';
import { pickingLineFormat, sortPickingItems, type DocumentItemRow, type DocumentOrderRow } from '@/lib/orders/documents/viewModels';

/**
 * « Session de préparation » : liste groupée par article de plusieurs
 * commandes (stateless, la sélection vit dans l'URL). Pure : partagée par la
 * page /admin/orders/preparation et le PDF `preparation-summary`.
 *
 * - une ligne = même produit, même libellé vendu et même format acheté
 *   (snapshot de la ligne de commande) ; une ligne sans produit reste à part ;
 * - la répartition par commande est toujours conservée ;
 * - ordre de parcours = celui des listes individuelles (sortPickingItems) :
 *   secs d'abord, frais ensuite, surgelés en dernier, puis l'emplacement ;
 * - « à vérifier » uniquement sur des faits du catalogue actuel (produit
 *   retiré, stock négatif), jamais une estimation.
 */

export type SummaryStorage = 'dry' | 'fresh' | 'frozen';

export interface SummaryOrderInput {
  order: DocumentOrderRow;
  items: Array<DocumentItemRow & { picked_at?: string | null }>;
  productWeights?: ReadonlyMap<string, number>;
  /** Digital checklist in use (snapshot digital, preparation started): line picks are shown. */
  trackDigital?: boolean;
}

export interface CatalogueFact { stock: number | null; active: boolean }

export interface SummaryLineVM {
  key: string;
  name: string;
  nameAlt: string | null;
  storage: SummaryStorage;
  location: string | null;
  /** Purchased format (order line snapshot); catalogueWeight only as a fallback without snapshot. */
  format: string | null;
  catalogueWeight: string | null;
  total: number;
  /** picked: null when the order does not use the digital checklist (paper, not started…). */
  perOrder: Array<{ orderId: string; ref: string; quantity: number; picked: boolean | null }>;
  /** Catalogue fact worth checking before picking (never an estimate). */
  check: string | null;
}

export interface SummaryGroupVM { storage: SummaryStorage; label: string; hint: string | null; lines: SummaryLineVM[] }

export interface SummaryOrderVM {
  orderId: string;
  ref: string;
  customerName: string;
  fulfillmentLabel: string;
  destination: string | null;
  units: number;
  cold: boolean;
}

export interface PreparationSummaryVM {
  orderCount: number;
  totalUnits: number;
  referenceCount: number;
  groups: SummaryGroupVM[];
  orders: SummaryOrderVM[];
  linesToCheck: number;
}

export const SUMMARY_GROUP_META: Record<SummaryStorage, { label: string; hint: string | null }> = {
  dry: { label: 'Secs et ambiants', hint: null },
  fresh: { label: 'Frais', hint: 'À prendre en fin de parcours' },
  frozen: { label: 'Surgelés', hint: 'En dernier, emballage isotherme' },
};

function storageOf(value: string | null | undefined): SummaryStorage {
  return value === 'fresh' || value === 'frozen' ? value : 'dry';
}

// Two orders of the same product bought in different formats stay on separate lines.
export function summaryLineKey(item: Pick<DocumentItemRow, 'product_id' | 'name' | 'name_alt' | 'storage_type' | 'format_snapshot'>, index: number, orderId: string): string {
  return item.product_id
    ? `${item.product_id}|${item.name.trim().toLowerCase()}|${(item.name_alt ?? '').trim().toLowerCase()}|${storageOf(item.storage_type)}|${(pickingLineFormat(item).format ?? '').toLowerCase()}`
    : `free|${orderId}|${index}`;
}

export function buildPreparationSummary(input: SummaryOrderInput[], catalogue: ReadonlyMap<string, CatalogueFact> = new Map()): PreparationSummaryVM {
  const printable = input.filter(({ order }) => order.status !== 'cancelled');
  const lines = new Map<string, SummaryLineVM & { warehouse_location: string | null; storage_type: SummaryStorage; productId: string | null }>();

  for (const { order, items, productWeights, trackDigital } of printable) {
    const ref = orderShortRef(order.id);
    items.forEach((item, index) => {
      const key = summaryLineKey(item, index, order.id);
      const storage = storageOf(item.storage_type);
      const location = item.warehouse_location?.trim() || null;
      let line = lines.get(key);
      if (!line) {
        line = {
          key, name: item.name, nameAlt: item.name_alt, storage, location, ...pickingLineFormat(item, productWeights),
          total: 0, perOrder: [], check: null, warehouse_location: location, storage_type: storage, productId: item.product_id,
        };
        lines.set(key, line);
      }
      if (!line.location && location) { line.location = location; line.warehouse_location = location; }
      line.total += item.quantity;
      const picked = trackDigital ? Boolean(item.picked_at) : null;
      const existing = line.perOrder.find((entry) => entry.orderId === order.id);
      if (existing) {
        existing.quantity += item.quantity;
        if (existing.picked !== null) existing.picked = existing.picked && Boolean(picked);
      } else line.perOrder.push({ orderId: order.id, ref, quantity: item.quantity, picked });
    });
  }

  for (const line of Array.from(lines.values())) {
    if (!line.productId) continue;
    const fact = catalogue.get(line.productId);
    if (!fact) { if (catalogue.size > 0) line.check = 'Produit retiré du catalogue'; continue; }
    if (!fact.active) line.check = 'Produit désactivé dans le catalogue';
    else if (fact.stock !== null && fact.stock < 0) line.check = `Stock catalogue négatif (${fact.stock})`;
  }

  const sorted = sortPickingItems(Array.from(lines.values()));
  const groups: SummaryGroupVM[] = (['dry', 'fresh', 'frozen'] as const)
    .map((storage) => ({ storage, ...SUMMARY_GROUP_META[storage], lines: sorted.filter((line) => line.storage === storage).map(stripInternal) }))
    .filter((group) => group.lines.length > 0);

  const orders: SummaryOrderVM[] = printable.map(({ order, items }) => {
    const a = (order.shipping_address ?? {}) as Record<string, string | undefined>;
    const pickup = order.fulfillment_type === 'pickup';
    return {
      orderId: order.id,
      ref: orderShortRef(order.id),
      customerName: order.full_name?.trim() || 'Client',
      fulfillmentLabel: pickup ? 'Retrait' : 'Livraison',
      destination: pickup ? null : [[a.postal_code, a.city].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ') || null,
      units: items.reduce((sum, item) => sum + item.quantity, 0),
      cold: items.some((item) => item.storage_type === 'fresh' || item.storage_type === 'frozen'),
    };
  });

  return {
    orderCount: orders.length,
    totalUnits: orders.reduce((sum, order) => sum + order.units, 0),
    referenceCount: lines.size,
    groups,
    orders,
    linesToCheck: Array.from(lines.values()).filter((line) => line.check).length,
  };
}

function stripInternal(line: SummaryLineVM & { warehouse_location: string | null; storage_type: SummaryStorage; productId: string | null }): SummaryLineVM {
  return {
    key: line.key, name: line.name, nameAlt: line.nameAlt, storage: line.storage, location: line.location,
    format: line.format, catalogueWeight: line.catalogueWeight, total: line.total, perOrder: line.perOrder, check: line.check,
  };
}

export function summaryGeneratedLabel(now: Date): string {
  return formatDocumentDate(now.toISOString(), 'short');
}
