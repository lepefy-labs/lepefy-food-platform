import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

type SkipReason = 'wrong_status' | 'missing_tracking';

// Lo stato di destinazione è deciso server-side per ogni ordine, mai dal
// client: è l'unico modo per rispettare le regole quando la selezione
// contiene ordini misti (delivery + pickup, con e senza tracking).
export async function POST(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
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

  const admin  = createServiceClient();

  // Rilettura server-side dello stato reale — mai fidarsi di quello che il
  // client pensa di aver selezionato, potrebbe essere cambiato nel frattempo.
  const { data: orders, error: fetchError } = await admin
    .from('orders')
    .select('id, status, fulfillment_type, tracking_code')
    .in('id', orderIds)
    .eq('tenant_id', tenant.id);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const toShipped:        string[] = [];
  const toReadyForPickup: string[] = [];
  const trackingUpdates:  { id: string; carrier: string; code: string }[] = [];
  const skipped: { id: string; reason: SkipReason }[] = [];

  for (const order of orders ?? []) {
    // Regola 1 — solo da 'preparing': blocca ogni regressione (delivered→shipped,
    // shipped→shipped, cancelled→shipped, ecc.)
    if (order.status !== 'preparing') {
      skipped.push({ id: order.id, reason: 'wrong_status' });
      continue;
    }

    // Regola 2 — un C&C non diventa mai 'shipped', diventa 'ready_for_pickup'
    if (order.fulfillment_type === 'pickup') {
      toReadyForPickup.push(order.id);
      continue;
    }

    // Regola 3 — una consegna richiede tracking_code già valorizzato, oppure
    // fornito ora dal pannello di compilazione (secondo giro della bulk bar)
    const providedTracking = tracking?.[order.id];
    const hasTracking = (order.tracking_code && order.tracking_code.trim() !== '')
                      || (providedTracking?.code && providedTracking.code.trim() !== '');

    if (!hasTracking) {
      skipped.push({ id: order.id, reason: 'missing_tracking' });
      continue;
    }

    if (providedTracking) {
      trackingUpdates.push({ id: order.id, ...providedTracking });
    }
    toShipped.push(order.id);
  }

  for (const t of trackingUpdates) {
    const { error } = await admin
      .from('orders')
      .update({ tracking_code: t.code, tracking_carrier: t.carrier })
      .eq('id', t.id)
      .eq('tenant_id', tenant.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (toShipped.length > 0) {
    // shipped_at come nel PATCH singolo (api/admin/orders/[id]/route.ts)
    const { error } = await admin
      .from('orders')
      .update({ status: 'shipped', shipped_at: new Date().toISOString() })
      .in('id', toShipped)
      .eq('tenant_id', tenant.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (toReadyForPickup.length > 0) {
    const { error } = await admin
      .from('orders')
      .update({ status: 'ready_for_pickup' })
      .in('id', toReadyForPickup)
      .eq('tenant_id', tenant.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    shipped:        toShipped,
    readyForPickup: toReadyForPickup,
    skipped,
  });
}
