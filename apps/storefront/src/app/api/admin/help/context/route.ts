import { NextRequest, NextResponse } from 'next/server';
import { helpTenantApi, normalizeHelpLocale } from '@/lib/helpCenter/server/access';
import { helpForContext } from '@/lib/helpCenter/server/service';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * GET /api/admin/help/context?pathname=/admin/orders&action=… — guides for the
 * page the admin is on. The pathname is normalised (ids masked, no query);
 * authorisation is applied server-side before anything is returned.
 */
export async function GET(request: NextRequest) {
  const guard = await helpTenantApi();
  if (!guard.ok) return guard.response;
  const params = request.nextUrl.searchParams;
  const action = params.get('action');
  const result = await helpForContext(
    { tenantId: guard.tenant.id, access: guard.access, level: guard.level, locale: normalizeHelpLocale(params.get('lang')) },
    params.get('pathname'),
    action && /^[a-z_]{2,40}$/.test(action) ? action : null,
  );
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
}
