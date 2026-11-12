import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { readJson, studioApi, studioErrorResponse } from '@/lib/studio/server/access';
import { requestCorrection, retryRevision } from '@/lib/studio/server/assets';
import { STUDIO_LIMITS } from '@/lib/studio/domain';
import { cleanText, isRequestKey, isUuid } from '@/lib/studio/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST — `{ action: 'correct', baseRevisionId, request, requestKey }` asks a
 * new version from an existing proposal; `{ action: 'retry', revisionId }`
 * requeues a failed one (no quota: nothing was produced).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await studioApi();
  if (!guard.ok) return guard.response;
  const body = await readJson(request);
  if (!body || !isUuid(params.id)) return NextResponse.json({ error: 'Demande invalide.' }, { status: 400 });
  const db = createServiceClient();
  try {
    if (body.action === 'retry') {
      if (!isUuid(body.revisionId)) return NextResponse.json({ error: 'Demande invalide.' }, { status: 400 });
      // The revision must belong to this image of this tenant.
      const { data } = await db.from('studio_revisions').select('id').eq('tenant_id', guard.tenant.id).eq('asset_id', params.id).eq('id', body.revisionId).maybeSingle();
      if (!data) return NextResponse.json({ error: 'Image introuvable.' }, { status: 404 });
      return NextResponse.json(await retryRevision(db, guard.tenant.id, body.revisionId));
    }
    if (body.action === 'correct') {
      const text = cleanText(body.request, STUDIO_LIMITS.requestChars);
      if (!text || text.length < 3) return NextResponse.json({ error: 'Décrivez la correction souhaitée.' }, { status: 400 });
      if (!isUuid(body.baseRevisionId) || !isRequestKey(body.requestKey)) return NextResponse.json({ error: 'Demande invalide.' }, { status: 400 });
      const result = await requestCorrection(db, guard.tenant.id, guard.access, {
        assetId: params.id, baseRevisionId: body.baseRevisionId, request: text, requestKey: body.requestKey,
      });
      return NextResponse.json(result, { status: 201 });
    }
    return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 });
  } catch (error) {
    return studioErrorResponse(error);
  }
}
