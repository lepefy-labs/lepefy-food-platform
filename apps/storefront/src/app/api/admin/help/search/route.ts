import { NextRequest, NextResponse } from 'next/server';
import { createMemoryRateLimiter } from '@/lib/http/memoryRateLimit';
import { HELP_LIMITS } from '@/lib/helpCenter/domain';
import { helpTenantApi, normalizeHelpLocale } from '@/lib/helpCenter/server/access';
import { helpSearch } from '@/lib/helpCenter/server/service';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Per admin and per instance: enough for typing with a debounce, painful for scraping.
const allow = createMemoryRateLimiter({ limit: HELP_LIMITS.searchPerMinute, windowMs: 60_000 });

/** GET /api/admin/help/search?q= — published guides this admin may read. */
export async function GET(request: NextRequest) {
  const guard = await helpTenantApi();
  if (!guard.ok) return guard.response;
  if (!allow(`${guard.tenant.id}:${guard.adminId}`)) {
    return NextResponse.json({ error: 'Trop de recherches. Réessayez dans une minute.' }, { status: 429, headers: { 'Retry-After': '30' } });
  }
  const params = request.nextUrl.searchParams;
  const results = await helpSearch(
    { tenantId: guard.tenant.id, access: guard.access, level: guard.level, locale: normalizeHelpLocale(params.get('lang')) },
    params.get('q'),
  );
  return NextResponse.json({ results }, { headers: { 'Cache-Control': 'private, no-store' } });
}
