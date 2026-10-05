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

export interface LoadedDocumentOrder {
  order: DocumentOrderRow;
  items: DocumentItemRow[];
  carton: ReturnType<typeof computeCartonSuggestion> & { maxParcelG: number } | null;
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
    db.from('order_items').select(ITEM_COLUMNS).eq('tenant_id', tenantId).in('order_id', ids),
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
    orders.push({ order, items, carton });
  }
  return { orders, missingIds };
}
