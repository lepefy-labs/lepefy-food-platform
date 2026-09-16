import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getShippingIntegrationAdapter } from '@/lib/shipping/integrations/registry';
import { syncOrderShippingIntegration, type SyncOrder, type SyncTenant } from '@/lib/shipping/integrations/syncOrderShippingIntegration';
import type { ShippingDetailsWithIntegration } from '@/lib/shipping/integrations/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

const MAX_ORDERS_PER_RUN = 50;

function authorized(request: NextRequest): boolean {
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }

  const supabase = createServiceClient();
  const { data: tenantsRaw, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, shipping_provider, packlink_api_key')
    .eq('active', true);

  if (tenantsError) {
    console.error('[shipping-sync] tenant lookup failed:', tenantsError);
    return NextResponse.json({ error: 'tenant_lookup_failed' }, { status: 503, headers });
  }

  let examined = 0;
  let synced = 0;
  let transitioned = 0;
  const failures: Array<{ orderId: string; provider: string; error: string }> = [];

  for (const tenantRaw of tenantsRaw ?? []) {
    if (examined >= MAX_ORDERS_PER_RUN) break;
    const tenant = tenantRaw as unknown as SyncTenant;
    if (!getShippingIntegrationAdapter(tenant.shipping_provider)) continue;

    const { data: ordersRaw, error: ordersError } = await supabase
      .from('orders')
      .select('id, tenant_id, status, email, full_name, fulfillment_type, shipping_details, tracking_code, tracking_carrier, packing_completed_at, packing_parcel_count')
      .eq('tenant_id', tenant.id)
      .eq('fulfillment_type', 'delivery')
      .in('status', ['preparing', 'shipped'])
      .order('updated_at', { ascending: true })
      .limit(MAX_ORDERS_PER_RUN - examined);

    if (ordersError) {
      failures.push({ orderId: '*', provider: tenant.shipping_provider, error: 'order_lookup_failed' });
      continue;
    }

    for (const raw of ordersRaw ?? []) {
      if (examined >= MAX_ORDERS_PER_RUN) break;
      const order = raw as unknown as SyncOrder;
      const details = (order.shipping_details ?? {}) as ShippingDetailsWithIntegration;
      const integration = details.integration;
      if (!integration?.reference || integration.provider !== tenant.shipping_provider) continue;

      examined += 1;
      try {
        const result = await syncOrderShippingIntegration({ tenant, order });
        synced += 1;
        transitioned += result.transitions.length;
      } catch (error) {
        failures.push({
          orderId: order.id,
          provider: tenant.shipping_provider,
          error: error instanceof Error ? error.message : 'sync_failed',
        });
      }
    }
  }

  return NextResponse.json({
    ok: failures.length === 0,
    examined,
    synced,
    transitioned,
    failures: failures.slice(0, 20),
  }, { headers });
}
