import type { Order } from '@lepefy/types';
import {
  loadWorkflowOrder, OrderWorkflowError, updateWorkflowOrder, type OrderService,
} from '@/lib/orders/orderTransitionService';
import { MAX_BULK_ORDER_DOCUMENTS } from '@/lib/orders/documents/formats';
import { effectivePreparationMode, modeOnStart, preparationState, type OrderPreparationMode, type PreparationItem, type StartResult } from './preparationPolicy';
import { readTenantPreparationMode } from './settings';

/**
 * Server writes of the paper flow (migration 160). Every write is
 * tenant-scoped, compare-and-set and idempotent: a retry or a second click
 * changes nothing and returns the current state. Status changes go through
 * updateWorkflowOrder (same validation, CAS and side effects as the detail
 * page). Nothing here touches the digital checks, ships, or invents a parcel
 * count.
 */

export type { StartResult, StartSkipReason } from './preparationPolicy';

async function loadItems(service: OrderService, order: Order): Promise<PreparationItem[]> {
  const { data, error } = await service.from('order_items').select('storage_type, picked_at, cold_chain_checked_at')
    .eq('order_id', order.id).eq('tenant_id', order.tenant_id);
  if (error) throw new OrderWorkflowError('Impossible de lire les articles.', 503);
  return (data ?? []) as PreparationItem[];
}

/**
 * « Imprimer et démarrer la préparation »: records that the team takes the
 * printed list (not that anything was picked). New → preparing; the tenant's
 * mode is snapshotted when the order adopts one (modeOnStart).
 */
export async function startPreparation(input: {
  service: OrderService;
  tenantId: string;
  orderIds: string[];
  actorId: string | null;
  tenantMode: OrderPreparationMode | null;
  now?: () => Date;
  update?: typeof updateWorkflowOrder;
}): Promise<StartResult> {
  const { service, tenantId, actorId, tenantMode } = input;
  const update = input.update ?? updateWorkflowOrder;
  const ids = Array.from(new Set(input.orderIds));
  if (ids.length === 0) throw new OrderWorkflowError('Aucune commande sélectionnée.', 400);
  if (ids.length > MAX_BULK_ORDER_DOCUMENTS) throw new OrderWorkflowError(`Sélectionnez ${MAX_BULK_ORDER_DOCUMENTS} commandes au maximum.`, 413);
  const result: StartResult = { ready: [], started: [], skipped: [] };

  for (const id of ids) {
    let order: Order;
    try { order = await loadWorkflowOrder(service, tenantId, id); } catch (error) {
      if (error instanceof OrderWorkflowError && error.httpStatus === 404) { result.skipped.push({ id, reason: 'not_found' }); continue; }
      throw error;
    }
    if (order.status === 'stock_conflict') { result.skipped.push({ id, reason: 'stock_conflict' }); continue; }
    if (order.status !== 'new' && order.status !== 'preparing') { result.skipped.push({ id, reason: 'not_preparable' }); continue; }
    if (order.payment_status !== 'paid') { result.skipped.push({ id, reason: 'payment' }); continue; }

    const nowIso = (input.now?.() ?? new Date()).toISOString();
    const items = await loadItems(service, order);
    const adopted = tenantMode ? modeOnStart(order, items, tenantMode) : null;
    const mode = adopted ?? effectivePreparationMode(order).mode;
    const patch: Record<string, unknown> = {};
    if (adopted) patch.preparation_mode = adopted;
    if (tenantMode && !order.picking_list_printed_at) patch.picking_list_printed_at = nowIso;
    if (tenantMode && mode.picking === 'paper' && !order.paper_preparation_started_at) {
      patch.paper_preparation_started_at = nowIso;
      patch.paper_preparation_started_by = actorId;
    }
    try {
      if (order.status === 'new') {
        await update({ service, order, nextStatus: 'preparing', patch });
        result.started.push(id);
      } else if (Object.keys(patch).length > 0) {
        await update({ service, order, patch });
      }
      result.ready.push(id);
    } catch (error) {
      // Lost CAS race (another click, another device): the winner already did the work.
      if (error instanceof OrderWorkflowError && error.httpStatus === 409) {
        const fresh = await loadWorkflowOrder(service, tenantId, id).catch(() => null);
        if (fresh && fresh.status === 'preparing') result.ready.push(id);
        else result.skipped.push({ id, reason: 'conflict' });
        continue;
      }
      throw error;
    }
  }
  return result;
}

export interface PaperCompletionInput {
  service: OrderService;
  tenantId: string;
  orderId: string;
  actorId: string | null;
  allPrepared: boolean;
  parcelCount?: number | null;
  coldDeclared?: boolean;
  now?: () => Date;
}

/** « Préparation terminée » (paper mode): an explicit, named declaration. */
export async function completePaperPreparation(input: PaperCompletionInput): Promise<Order> {
  const { service, tenantId, orderId, actorId } = input;
  const order = await loadWorkflowOrder(service, tenantId, orderId);
  if (order.status !== 'preparing') throw new OrderWorkflowError('La préparation peut être confirmée uniquement pendant la préparation.');
  const scopedOrder = order.preparation_mode ? order : { ...order, tenantPreparationMode: await readTenantPreparationMode(service as never, tenantId) };
  const { mode, source: modeSource } = effectivePreparationMode(scopedOrder);
  if (mode.picking !== 'paper') throw new OrderWorkflowError('Cette commande est préparée dans Lepefy : utilisez la checklist.');
  if (order.payment_status !== 'paid') throw new OrderWorkflowError('Paiement à vérifier avant de terminer la préparation.');
  if (order.paper_preparation_completed_at) return order;
  if (!input.allPrepared) throw new OrderWorkflowError('Confirmez que tous les articles de la liste ont été préparés.', 400);

  const items = await loadItems(service, order);
  if (items.length === 0) throw new OrderWorkflowError('La commande ne contient aucun article à préparer.');
  const delivery = order.fulfillment_type === 'delivery';
  const state = preparationState(scopedOrder, items);
  const patch: Record<string, unknown> = {};
  const nowIso = (input.now?.() ?? new Date()).toISOString();
  if (delivery) {
    const parcels = input.parcelCount == null ? null : Number(input.parcelCount);
    if (parcels === null || !Number.isInteger(parcels) || parcels < 1 || parcels > 99) {
      throw new OrderWorkflowError('Indiquez le nombre de colis (entre 1 et 99).', 400);
    }
    patch.packing_parcel_count = parcels;
    if (!order.packing_started_at) patch.packing_started_at = nowIso;
    if (state.hasColdChain && mode.cold_chain_packing === 'paper') {
      if (!input.coldDeclared) throw new OrderWorkflowError('Confirmez l’emballage des produits frais et surgelés.', 400);
      patch.cold_chain_packing_declared_at = order.cold_chain_packing_declared_at ?? nowIso;
    }
  }
  if (modeSource === 'tenant') patch.preparation_mode = mode;
  patch.paper_preparation_completed_at = nowIso;
  patch.paper_preparation_completed_by = actorId;

  const { data, error } = await service.from('orders').update(patch)
    .eq('id', order.id).eq('tenant_id', tenantId).eq('status', 'preparing').is('paper_preparation_completed_at', null)
    .select('*').maybeSingle();
  if (error) throw new OrderWorkflowError('Impossible d’enregistrer la fin de préparation.', 503);
  // Lost race: someone confirmed first, their declaration stands.
  if (!data) return loadWorkflowOrder(service, tenantId, orderId);
  return data as Order;
}

/** Withdraws a mistaken declaration while the order is still in preparation. */
export async function withdrawPaperPreparation(input: { service: OrderService; tenantId: string; orderId: string }): Promise<Order> {
  const { service, tenantId, orderId } = input;
  const order = await loadWorkflowOrder(service, tenantId, orderId);
  if (order.status !== 'preparing') throw new OrderWorkflowError('La commande n’est plus en préparation.');
  if (!order.paper_preparation_completed_at) return order;
  const { data, error } = await service.from('orders')
    .update({ paper_preparation_completed_at: null, paper_preparation_completed_by: null, cold_chain_packing_declared_at: null })
    .eq('id', order.id).eq('tenant_id', tenantId).eq('status', 'preparing')
    .select('*').maybeSingle();
  if (error) throw new OrderWorkflowError('Impossible d’annuler la confirmation.', 503);
  if (!data) throw new OrderWorkflowError('La commande a été modifiée. Actualisez et réessayez.');
  return data as Order;
}
