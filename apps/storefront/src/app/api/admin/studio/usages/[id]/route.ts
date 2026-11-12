import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { studioApi, studioErrorResponse } from '@/lib/studio/server/access';
import { removeStudioUsage } from '@/lib/studio/server/publish';
import { isUuid } from '@/lib/studio/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE — « Retirer d'ici »: clears the slot only if it still shows this
 * copy, then deletes that copy (never another destination's). Product images
 * are only detached (immutable sets, same rule as the product gallery).
 */
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await studioApi();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Introuvable.' }, { status: 404 });
  try {
    return NextResponse.json(await removeStudioUsage(createServiceClient(), guard.tenant, guard.access, params.id));
  } catch (error) {
    return studioErrorResponse(error);
  }
}
