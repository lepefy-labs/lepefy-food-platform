import { NextResponse } from 'next/server';
import { SUPPORT_LIMITS } from '@/lib/support/domain';
import { cleanMessageBody } from '@/lib/support/rules';
import { supportTenantApi } from '@/lib/support/server/access';
import { similarTickets } from '@/lib/support/server/tenantService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Open requests of the SAME shop that look like the text being written
 * (PostgreSQL full text, no AI). Never blocks: an error returns nothing.
 */
export async function GET(request: Request) {
  const guard = await supportTenantApi({ write: false });
  if (!guard.ok) return guard.response;
  const text = cleanMessageBody(new URL(request.url).searchParams.get('q') ?? '').slice(0, 1000);
  if (text.length < SUPPORT_LIMITS.similarMinChars) return NextResponse.json({ similar: [] });
  try {
    return NextResponse.json({ similar: await similarTickets(guard.tenant.id, text) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ similar: [] });
  }
}
