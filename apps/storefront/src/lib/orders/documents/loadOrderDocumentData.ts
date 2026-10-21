import type { createServiceClient } from '@/lib/supabase/server';
import { computeCartonSuggestion, loadCartonContext, type CartonContext } from '@/lib/shipping/loadCartonSuggestion';
import type { DocumentItemRow, DocumentOrderRow } from './viewModels';

/**
 * Chargement en lot, tenant-scoped, des données des documents de commande :
 * 1 requête `orders`, 1 requête `order_items` (filtrée aussi par tenant_id),
 * et pour la liste de préparation 1 contexte carton partagé par tout le lot.
 * Colonnes explicites : ni notes, ni e-mail, ni téléphone, ni paiement ne
 * sont lus — ils ne peuvent donc atteindre aucun document.
 */
type ServiceClient = ReturnType<typeof createServiceClient>;

export type OrderDocumentMode = 'picking' | 'packing';

const ORDER_COLUMNS = 'id, created_at, status, fulfillment_type, full_name, shipping_address, shipping_details, shipping_cost, total';
const ITEM_COLUMNS = 'order_id, product_id, name, name_alt, price, quantity, subtotal, storage_type, warehouse_location';
/** Format figé à la commande (migration 162), lu seulement pour le récapitulatif client. */
const FORMAT_SNAPSHOT_COLUMN = 'format_snapshot';

/** Colonne absente (migration 162 pas encore appliquée) : PostgREST 42703 / PGRST204. */
function isMissingFormatSnapshotColumn(error: unknown): boolean {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  return code === '42703' || code === 'PGRST204' || Boolean(message?.includes(FORMAT_SNAPSHOT_COLUMN));
}

/**
 * Lignes de commande du lot. Pour le récapitulatif client, essaie d'abord
 * avec le snapshot de format ; sans la 162, relit sans (pas de format affiché,
 * comportement historique) au lieu d'empêcher l'impression.
 */
async function loadItems(db: ServiceClient, tenantId: string, ids: string[], mode: OrderDocumentMode) {
  if (mode === 'packing') {
    const result = await db.from('order_items').select(`${ITEM_COLUMNS}, ${FORMAT_SNAPSHOT_COLUMN}`).eq('tenant_id', tenantId).in('order_id', ids);
    if (!result.error || !isMissingFormatSnapshotColumn(result.error)) return result;
  }
  return db.from('order_items').select(ITEM_COLUMNS).eq('tenant_id', tenantId).in('order_id', ids);
}

export interface LoadedDocumentOrder {
  order: DocumentOrderRow;
  items: DocumentItemRow[];
  carton: ReturnType<typeof computeCartonSuggestion> & { maxParcelG: number } | null;
  productWeights: ReadonlyMap<string, number>;
}

export interface LoadedOrderDocuments {
  /** Dans l'ordre des identifiants demandés (déterministe). */
  orders: LoadedDocumentOrder[];
  /** Identifiants absents ou appartenant à un autre tenant. */
  missingIds: string[];
}

export class OrderDocumentDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderDocumentDataError';
  }
}

export async function loadOrderDocumentData(
  db: ServiceClient,
  { tenantId, orderIds, mode }: { tenantId: string; orderIds: string[]; mode: OrderDocumentMode },
): Promise<LoadedOrderDocuments> {
  const ids = Array.from(new Set(orderIds));
  if (ids.length === 0) return { orders: [], missingIds: [] };

  const [ordersResult, itemsResult] = await Promise.all([
    db.from('orders').select(ORDER_COLUMNS).eq('tenant_id', tenantId).in('id', ids),
    loadItems(db, tenantId, ids, mode),
  ]);
  if (ordersResult.error) throw new OrderDocumentDataError('orders_unavailable');
  if (itemsResult.error) throw new OrderDocumentDataError('items_unavailable');

  const byId = new Map(((ordersResult.data ?? []) as DocumentOrderRow[]).map((order) => [order.id, order]));
  const itemsByOrder = new Map<string, DocumentItemRow[]>();
  for (const item of (itemsResult.data ?? []) as DocumentItemRow[]) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }

  // Les poids actuels du catalogue sont indicatifs, pas des snapshots historiques.
  // Chargement en une requête par lot, y compris pour les commandes à retirer.
  const productWeights = new Map<string, number>();
  if (mode === 'picking') {
    const productIds = Array.from(new Set((itemsResult.data ?? [])
      .map((item) => (item as DocumentItemRow).product_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)));
    if (productIds.length > 0) {
      const { data: products, error: productError } = await db.from('products')
        .select('id, weight_grams').eq('tenant_id', tenantId).in('id', productIds);
      // Le PDF doit rester imprimable si le catalogue n'est pas disponible.
      if (!productError) for (const product of products ?? []) {
        const weight = Number(product.weight_grams);
        if (product.weight_grams != null && Number.isFinite(weight) && weight > 0) productWeights.set(product.id, weight);
      }
    }
  }

  let cartonContext: CartonContext | null = null;
  if (mode === 'picking') {
    const needsCarton = ids.map((id) => byId.get(id)).filter((order): order is DocumentOrderRow =>
      Boolean(order && order.fulfillment_type === 'delivery' && order.status !== 'cancelled'));
    if (needsCarton.length > 0) {
      const productIds = needsCarton.flatMap((order) => (itemsByOrder.get(order.id) ?? []).map((item) => item.product_id));
      // Le carton est une aide : une lecture impossible ne bloque jamais l'impression.
      cartonContext = await loadCartonContext(db, tenantId, productIds).catch(() => null);
    }
  }

  const orders: LoadedDocumentOrder[] = [];
  const missingIds: string[] = [];
  for (const id of ids) {
    const order = byId.get(id);
    if (!order) { missingIds.push(id); continue; }
    const items = itemsByOrder.get(id) ?? [];
    let carton: LoadedDocumentOrder['carton'] = null;
    if (cartonContext && order.fulfillment_type === 'delivery' && order.status !== 'cancelled') {
      const checkoutWeight = (order.shipping_details as { totalWeightG?: number } | null)?.totalWeightG;
      carton = { ...computeCartonSuggestion(cartonContext, items, checkoutWeight), maxParcelG: cartonContext.maxParcelG };
    }
    orders.push({ order, items, carton, productWeights });
  }
  return { orders, missingIds };
}
