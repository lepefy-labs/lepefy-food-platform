import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { studioApi, studioErrorResponse } from '@/lib/studio/server/access';
import { availableDestinations, destinationFor } from '@/lib/studio/server/publish';
import { STUDIO_DESTINATION_IMPLS } from '@/lib/studio/server/destinations';
import { cleanText } from '@/lib/studio/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET — without `key`: destinations this admin may publish to (registry ∩
 * permissions ∩ modules). With `key` (+ `q`): targets of that destination,
 * read with the tenant filter.
 */
export async function GET(request: NextRequest) {
  const guard = await studioApi();
  if (!guard.ok) return guard.response;
  const key = request.nextUrl.searchParams.get('key');
  try {
    if (!key) {
      return NextResponse.json({ destinations: availableDestinations(guard.access, guard.tenant) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const destination = destinationFor(guard.access, guard.tenant, key);
    const q = cleanText(request.nextUrl.searchParams.get('q'), 80);
    const targets = await STUDIO_DESTINATION_IMPLS[destination.key].targets(createServiceClient(), guard.tenant, q);
    return NextResponse.json({ targets }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return studioErrorResponse(error);
  }
}
