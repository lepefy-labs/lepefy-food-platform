import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getShippingIntegrationAdapter } from '@/lib/shipping/integrations/registry';
import { syncOrderShippingIntegration, type SyncOrder } from '@/lib/shipping/integrations/syncOrderShippingIntegration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  if (!getShippingIntegrationAdapter(tenant.shipping_provider)) {
    return NextResponse.json(
      { error: `Le provider ${tenant.shipping_provider} utilise le workflow manuel.` },
      { status: 409 },
    );
  }

  let body: { reference?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // A sync request may intentionally omit the body and reuse the stored reference.
  }
  const reference = typeof body.reference === 'string' ? body.reference.trim() : undefined;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('orders')
    .select('id, tenant_id, status, email, full_name, fulfillment_type, shipping_details, tracking_code, tracking_carrier, packing_completed_at, packing_parcel_count')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
  }

  try {
    const result = await syncOrderShippingIntegration({
      tenant: {
        id: tenant.id,
        shipping_provider: tenant.shipping_provider,
        packlink_api_key: tenant.packlink_api_key,
      },
      order: data as unknown as SyncOrder,
      reference,
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Synchronisation impossible.';
    console.error('[admin/order shipping integration] sync failed:', message, '— order_id:', params.id);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
