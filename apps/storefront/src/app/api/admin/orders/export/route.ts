import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { loadOrderWorkQueue } from '@/lib/orders/loadOrderWorkQueue';
import { loadOrderOperationalContext, parseOrderList } from '@/lib/orders/orderListParams';
import { buildOrdersCsv, ORDER_EXPORT_LIMIT, type ExportOrderRow } from '@/lib/orders/ordersCsv';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

/**
 * CSV of the orders list with the filters and sort of /admin (same query
 * string). Read-only, `orders.view` (adminApiPermissions), capped at
 * ORDER_EXPORT_LIMIT rows; X-Export-Truncated tells when the cap was hit.
 */
export async function GET(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const db = createServiceClient();
  const { filters, sort } = parseOrderList(req.nextUrl.searchParams);
  const context = await loadOrderOperationalContext(db, tenant);
  let result;
  try {
    result = await loadOrderWorkQueue(db, tenant.id, {
      filters, sort, page: 1, pageSize: ORDER_EXPORT_LIMIT, now: new Date(),
      thresholds: context.thresholds, managedProviderAvailable: context.managedProviderAvailable, originCountry: tenant.country,
    });
  } catch (error) {
    console.error('[admin/orders/export] work queue unavailable', error);
    return NextResponse.json({ error: 'Export impossible pour le moment. Réessayez.' }, { status: 503 });
  }

  const csv = buildOrdersCsv(result.rows as unknown as ExportOrderRow[]);
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="commandes-${date}.csv"`,
      'Cache-Control': 'no-store',
      'X-Export-Truncated': result.total > ORDER_EXPORT_LIMIT ? 'true' : 'false',
    },
  });
}
