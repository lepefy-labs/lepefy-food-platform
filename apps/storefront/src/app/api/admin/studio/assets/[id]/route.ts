import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { readJson, studioApi, studioErrorResponse } from '@/lib/studio/server/access';
import { decideAsset, getStudioAsset } from '@/lib/studio/server/assets';
import { STUDIO_LIMITS } from '@/lib/studio/domain';
import { cleanText, isUuid } from '@/lib/studio/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: { id: string } };

/** GET — one image: versions (signed private URLs), usages, busy flag. */
export async function GET(_request: NextRequest, { params }: Context) {
  const guard = await studioApi();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Image introuvable.' }, { status: 404 });
  try {
    const asset = await getStudioAsset(createServiceClient(), guard.tenant.id, params.id, guard.access);
    if (!asset) return NextResponse.json({ error: 'Image introuvable.' }, { status: 404 });
    return NextResponse.json({ asset }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return studioErrorResponse(error);
  }
}

const ACTIONS = new Set(['approve', 'discard', 'archive', 'restore', 'rename']);

/** PATCH — approve a version, discard, archive, restore or rename. */
export async function PATCH(request: NextRequest, { params }: Context) {
  const guard = await studioApi();
  if (!guard.ok) return guard.response;
  const body = await readJson(request);
  const action = typeof body?.action === 'string' && ACTIONS.has(body.action) ? body.action as 'approve' | 'discard' | 'archive' | 'restore' | 'rename' : null;
  if (!isUuid(params.id) || !action) return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 });
  if (action === 'approve' && !isUuid(body?.revisionId)) return NextResponse.json({ error: 'Choisissez la version à approuver.' }, { status: 400 });
  try {
    const status = await decideAsset(createServiceClient(), guard.tenant.id, guard.access, {
      assetId: params.id, action, revisionId: isUuid(body?.revisionId) ? body!.revisionId as string : null,
      title: cleanText(body?.title, STUDIO_LIMITS.titleChars),
    });
    return NextResponse.json({ status });
  } catch (error) {
    return studioErrorResponse(error);
  }
}
