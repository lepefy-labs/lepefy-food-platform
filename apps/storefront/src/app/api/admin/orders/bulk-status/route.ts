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

type SkipReason = 'wrong_status' | 'missing_tracking';

interface BulkOrderRow {
  id: string;
  status: OrderStatus;
  fulfillment_type: FulfillmentType;
  tracking_code: string | null;
  tracking_carrier: string | null;
  email: string;
  full_name: string | null;
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
  const { data: ordersRaw, error: fetchError } = await admin
    .from('orders')
    .select('id, status, fulfillment_type, tracking_code, tracking_carrier, email, full_name')
    .in('id', orderIds)
    .eq('tenant_id', tenant.id);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const orders = (ordersRaw ?? []) as unknown as BulkOrderRow[];
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

    for (const order of toShipped) {
      const providedTracking = tracking?.[order.id];
      await runOrderTransitionSideEffects({
        orderId: order.id,
        previousStatus: order.status,
        nextStatus: 'shipped',
        email: order.email,
        fullName: order.full_name,
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
  }

  return NextResponse.json({
    shipped: toShipped.map(order => order.id),
    readyForPickup: toReadyForPickup.map(order => order.id),
    skipped,
  });
}
