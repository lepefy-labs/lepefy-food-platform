import { NextRequest, NextResponse } from 'next/server';
import { createMemoryRateLimiter } from '@/lib/http/memoryRateLimit';
import { HELP_LIMITS } from '@/lib/helpCenter/domain';
import { isValidSlug } from '@/lib/helpCenter/rules';
import { helpTenantApi, readJsonBody } from '@/lib/helpCenter/server/access';
import { isHelpEvent, recordHelpEvent } from '@/lib/helpCenter/server/service';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const allow = createMemoryRateLimiter({ limit: HELP_LIMITS.eventsPerMinute, windowMs: 60_000 });

/**
 * POST /api/admin/help/events { slug, event } — view / useful / not useful /
 * support opened. One daily counter per tenant × guide × event: no identity,
 * no content. Always 204 (a metric never blocks the user).
 */
export async function POST(request: NextRequest) {
  const guard = await helpTenantApi();
  if (!guard.ok) return guard.response;
  if (!allow(`${guard.tenant.id}:${guard.adminId}`)) return new NextResponse(null, { status: 204 });
  const body = await readJsonBody(request, 2_000);
  if (body && isValidSlug(body.slug) && isHelpEvent(body.event)) {
    await recordHelpEvent({ tenantId: guard.tenant.id, access: guard.access, level: guard.level, locale: 'fr' }, body.slug, body.event);
  }
  return new NextResponse(null, { status: 204 });
}
