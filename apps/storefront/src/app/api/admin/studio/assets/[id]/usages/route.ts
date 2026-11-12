import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { readJson, studioApi, studioErrorResponse } from '@/lib/studio/server/access';
import { publishStudioImage } from '@/lib/studio/server/publish';
import { isRequestKey, isUuid } from '@/lib/studio/rules';
import type { StudioCrop } from '@/lib/studio/domain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST — « Confirmer et publier »: copies the approved version into the
 * destination's public folder and updates the slot (copy → verify → safe
 * update). Idempotent on `requestKey`. Needs the destination's own permission.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await studioApi();
  if (!guard.ok) return guard.response;
  const body = await readJson(request);
  if (!body || !isUuid(params.id) || typeof body.destination !== 'string' || typeof body.targetId !== 'string'
    || body.targetId.length > 100 || !isRequestKey(body.requestKey)) {
    return NextResponse.json({ error: 'Demande invalide.' }, { status: 400 });
  }
  try {
    const result = await publishStudioImage(createServiceClient(), guard.tenant, guard.access, {
      assetId: params.id,
      destinationKey: body.destination,
      targetId: body.targetId,
      crop: body.crop && typeof body.crop === 'object' ? body.crop as StudioCrop : null,
      asCover: body.asCover === true,
      confirmAmbiance: body.confirmAmbiance === true,
      requestKey: body.requestKey,
    });
    return NextResponse.json(result, { status: result.replay ? 200 : 201 });
  } catch (error) {
    return studioErrorResponse(error, 'La publication n’a pas abouti. Rien n’a été modifié sur la boutique : réessayez.');
  }
}
