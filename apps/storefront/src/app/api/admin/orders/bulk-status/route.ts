import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import {
  runOrderTransitionSideEffects,
  validateOrderTransition,
  type FulfillmentType,
} from '@/lib/orders/adminOrderWorkflow';
import type { OrderStatus } from '@lepefy/types';
import { preparationBlockers, preparationState, type PreparationOrder } from '@/lib/orders/preparation/preparationPolicy';
import { isMissingPreparationColumn, withoutPreparationColumns } from '@/lib/orders/preparation/compat';

const BULK_COLUMNS = 'id, status, fulfillment_type, tracking_code, tracking_carrier, email, full_name, packing_completed_at, packing_parcel_count, '
  + 'cold_chain_packing_checked_at, preparation_mode, cold_chain_packing_declared_at, paper_preparation_completed_at, preparation_unverified_at';

type SkipReason = 'wrong_status' | 'missing_tracking';

interface BulkOrderRow {
  id: string;
  status: OrderStatus;
  fulfillment_type: FulfillmentType;
  tracking_code: string | null;
  tracking_carrier: string | null;
  email: string;
  full_name: string | null;
  packing_completed_at: string | null;
  packing_parcel_count: number | null;
  preparation_mode: PreparationOrder['preparation_mode'];
  cold_chain_packing_checked_at: string | null;
  cold_chain_packing_declared_at: string | null;
  paper_preparation_completed_at: string | null;
  preparation_unverified_at: string | null;
}

interface PickingItemRow {
  order_id: string;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  picked_at: string | null;
  cold_chain_checked_at: string | null;
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const authError = await requireAdmin(tenant.id);
  if (authError) return authError;

  const { orderIds, tracking } = await req.json() as {
    orderIds: string[];
    tracking?: Record<string, { carrier: string; code: string }>;
  };

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: 'orderIds manquant ou vide.' }, { status: 400 });
  }

  const admin = createServiceClient();
  const readOrders = (columns: string) => admin.from('orders').select(columns).in('id', orderIds).eq('tenant_id', tenant.id);
  let { data: ordersRaw, error: fetchError } = await readOrders(BULK_COLUMNS);
  // Before migration 160: same rules without its columns (digital mode for every order).
  if (isMissingPreparationColumn(fetchError)) ({ data: ordersRaw, error: fetchError } = await readOrders(withoutPreparationColumns(BULK_COLUMNS)));

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const orders = (ordersRaw ?? []) as unknown as BulkOrderRow[];
  const preparingIds = orders.filter(order => order.status === 'preparing').map(order => order.id);
  const itemsByOrder = new Map<string, PickingItemRow[]>();

  if (preparingIds.length > 0) {
    const { data: pickingItemsRaw, error: pickingError } = await admin
      .from('order_items')
      .select('order_id, storage_type, picked_at, cold_chain_checked_at')
      .in('order_id', preparingIds)
      .eq('tenant_id', tenant.id);

    if (pickingError) {
      return NextResponse.json({ error: 'Impossible de vérifier la préparation des commandes.' }, { status: 500 });
    }
    for (const item of (pickingItemsRaw ?? []) as PickingItemRow[]) {
      const list = itemsByOrder.get(item.order_id) ?? [];
      list.push(item);
      itemsByOrder.set(item.order_id, list);
    }
  }

  // Same preparation rules as one-by-one transitions (preparationPolicy, mode snapshot of each order).
  const preparing = orders.filter(order => order.status === 'preparing');
  const incomplete = preparing.filter(order => preparationBlockers(order, itemsByOrder.get(order.id) ?? [], false).length > 0);
  if (incomplete.length > 0) {
    return NextResponse.json(
      {
        error: `Préparation incomplète pour ${incomplete.length} commande${incomplete.length > 1 ? 's' : ''}. Terminez ou confirmez la préparation avant de traiter la sélection.`,
        orderIds: incomplete.map(order => order.id),
      },
      { status: 409 },
    );
  }

  const incompletePacking = preparing.filter(order =>
    order.fulfillment_type === 'delivery' && preparationBlockers(order, itemsByOrder.get(order.id) ?? [], true).length > 0,
  );
  if (incompletePacking.length > 0) {
    return NextResponse.json(
      {
        error: `Emballage incomplet pour ${incompletePacking.length} commande${incompletePacking.length > 1 ? 's' : ''}. Renseignez les colis (et l’emballage froid) avant l’expédition.`,
        orderIds: incompletePacking.map(order => order.id),
      },
      { status: 409 },
    );
  }
  const unverifiedIds = new Set(preparing
    .filter(order => !order.preparation_unverified_at && preparationState(order, itemsByOrder.get(order.id) ?? []).unverified)
    .map(order => order.id));

  // « Sans confirmation »: the transition is recorded as made without any check (audited, best-effort).
  async function stampUnverified(moved: BulkOrderRow[]) {
    const ids = moved.filter(order => unverifiedIds.has(order.id)).map(order => order.id);
    if (ids.length === 0) return;
    const { error } = await admin.from('orders').update({ preparation_unverified_at: new Date().toISOString() })
      .in('id', ids).eq('tenant_id', tenant.id).is('preparation_unverified_at', null);
    if (error) console.error('[admin/orders/bulk-status] unverified stamp failed:', error.message);
  }

  const toShipped: BulkOrderRow[] = [];
  const toReadyForPickup: BulkOrderRow[] = [];
  const trackingUpdates: { id: string; carrier: string; code: string }[] = [];
  const skipped: { id: string; reason: SkipReason }[] = [];

  for (const order of orders) {
    if (order.status !== 'preparing') {
      skipped.push({ id: order.id, reason: 'wrong_status' });
      continue;
    }

    const nextStatus: OrderStatus = order.fulfillment_type === 'pickup'
      ? 'ready_for_pickup'
      : 'shipped';
    const providedTracking = tracking?.[order.id];
    const effectiveTrackingCode = providedTracking?.code ?? order.tracking_code;

    const validation = validateOrderTransition({
      current: order.status,
      next: nextStatus,
      fulfillmentType: order.fulfillment_type,
      trackingCode: effectiveTrackingCode,
    });

    if (!validation.ok) {
      skipped.push({
        id: order.id,
        reason: validation.error.includes('suivi') ? 'missing_tracking' : 'wrong_status',
      });
      continue;
    }

    if (providedTracking) {
      trackingUpdates.push({ id: order.id, ...providedTracking });
    }

    if (nextStatus === 'shipped') toShipped.push(order);
    else toReadyForPickup.push(order);
  }

  for (const item of trackingUpdates) {
    const { error } = await admin
      .from('orders')
      .update({ tracking_code: item.code, tracking_carrier: item.carrier })
      .eq('id', item.id)
      .eq('tenant_id', tenant.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (toShipped.length > 0) {
    const { error } = await admin
      .from('orders')
      .update({ status: 'shipped', shipped_at: new Date().toISOString() })
      .in('id', toShipped.map(order => order.id))
      .eq('tenant_id', tenant.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await stampUnverified(toShipped);

    for (const order of toShipped) {
      const providedTracking = tracking?.[order.id];
      await runOrderTransitionSideEffects({
        tenantId: tenant.id,
        orderId: order.id,
        previousStatus: order.status,
        nextStatus: 'shipped',
        email: order.email,
        fullName: order.full_name,
        fulfillmentType: order.fulfillment_type,
        trackingCode: providedTracking?.code ?? order.tracking_code,
        trackingCarrier: providedTracking?.carrier ?? order.tracking_carrier,
      });
    }
  }

  if (toReadyForPickup.length > 0) {
    const { error } = await admin
      .from('orders')
      .update({ status: 'ready_for_pickup' })
      .in('id', toReadyForPickup.map(order => order.id))
      .eq('tenant_id', tenant.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await stampUnverified(toReadyForPickup);

    for (const order of toReadyForPickup) {
      await runOrderTransitionSideEffects({
        tenantId: tenant.id,
        orderId: order.id,
        previousStatus: order.status,
        nextStatus: 'ready_for_pickup',
        email: order.email,
        fullName: order.full_name,
        fulfillmentType: order.fulfillment_type,
        trackingCode: order.tracking_code,
        trackingCarrier: order.tracking_carrier,
      });
    }
  }

  return NextResponse.json({
    shipped: toShipped.map(order => order.id),
    readyForPickup: toReadyForPickup.map(order => order.id),
    skipped,
  });
}
