import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import {
  FAILURE_HTTP_STATUS,
  listPacklinkShipments,
  orderLabel,
  type LepefyOrderLink,
} from '@/lib/shipping/packlinkShipmentList';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'private, no-store, max-age=0' };

// Read-only: one Packlink GET per call, one SELECT on the tenant's orders.
// Never creates, updates or links shipments/orders.
export async function GET() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const result = await listPacklinkShipments({
    shippingProvider: tenant.shipping_provider,
    apiKey: tenant.packlink_api_key,
    lookupOrders: async (references) => {
      const { data, error } = await createServiceClient()
        .from('orders')
        .select('id, status, created_at, shipping_provider_reference')
        .eq('tenant_id', tenant.id)
        .eq('shipping_provider_key', 'packlink')
        .in('shipping_provider_reference', references);
      if (error) throw error;
      const links = new Map<string, LepefyOrderLink>();
      for (const row of data ?? []) {
        if (!row.shipping_provider_reference) continue;
        links.set(String(row.shipping_provider_reference).toUpperCase(), {
          id: row.id,
          label: orderLabel(row.id),
          status: row.status ?? null,
          createdAt: row.created_at ?? null,
        });
      }
      return links;
    },
  });

  if (!result.available) {
    console.warn('[admin/packlink-shipments]', result.reason, result.diagnostics?.upstreamStatus ?? '-');
  }

  return NextResponse.json(result, {
    status: result.available ? 200 : FAILURE_HTTP_STATUS[result.reason],
    headers: noStore,
  });
}
