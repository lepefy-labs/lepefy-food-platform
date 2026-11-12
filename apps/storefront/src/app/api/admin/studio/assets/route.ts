import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { readJson, studioApi, studioErrorResponse } from '@/lib/studio/server/access';
import { createStudioAsset, listStudioAssets, studioQuota } from '@/lib/studio/server/assets';
import { STUDIO_LIBRARY_VIEWS, STUDIO_LIMITS, type StudioLibraryView } from '@/lib/studio/domain';
import { cleanText, defaultTitle, isRequestKey, STUDIO_ERRORS } from '@/lib/studio/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** GET — library page (polled by the client while something is in progress). */
export async function GET(request: NextRequest) {
  const guard = await studioApi();
  if (!guard.ok) return guard.response;
  const params = request.nextUrl.searchParams;
  const viewParam = params.get('statut') ?? 'toutes';
  const view = (STUDIO_LIBRARY_VIEWS as readonly string[]).includes(viewParam) ? viewParam as StudioLibraryView : 'toutes';
  const page = Math.max(1, Math.min(500, Number(params.get('page') ?? '1') || 1));
  try {
    const db = createServiceClient();
    const [list, quota] = await Promise.all([
      listStudioAssets(db, guard.tenant.id, { view, q: cleanText(params.get('q'), 80) ?? undefined, page }),
      studioQuota(db, guard.tenant.id),
    ]);
    return NextResponse.json({ ...list, quota }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return studioErrorResponse(error);
  }
}

/** POST — new image from a photo (upload adopted) or from an idea. */
export async function POST(request: NextRequest) {
  const guard = await studioApi();
  if (!guard.ok) return guard.response;
  const body = await readJson(request);
  if (!body) return NextResponse.json({ error: STUDIO_ERRORS.studio_invalid_request!.message }, { status: 400 });
  const origin = body.origin === 'photo' || body.origin === 'prompt' ? body.origin : null;
  const requestText = cleanText(body.request, STUDIO_LIMITS.requestChars);
  const uploadPath = typeof body.uploadPath === 'string' ? body.uploadPath : null;
  if (!origin || !isRequestKey(body.requestKey)) return NextResponse.json({ error: STUDIO_ERRORS.studio_invalid_request!.message }, { status: 400 });
  if (origin === 'prompt' && (!requestText || requestText.length < 3)) {
    return NextResponse.json({ error: 'Décrivez l’image souhaitée (quelques mots suffisent).' }, { status: 400 });
  }
  if (origin === 'photo' && !uploadPath) return NextResponse.json({ error: STUDIO_ERRORS.studio_upload_missing!.message }, { status: 400 });
  const title = cleanText(body.title, STUDIO_LIMITS.titleChars) ?? defaultTitle(origin, requestText);
  try {
    const result = await createStudioAsset(createServiceClient(), guard.tenant.id, guard.access, {
      origin, title, request: requestText, uploadPath, requestKey: body.requestKey,
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'unsupported_image') return studioErrorResponse(new Error('studio_upload_invalid'));
    if (message === 'image_too_small') return studioErrorResponse(new Error('studio_upload_small'));
    if (message === 'upload_not_found' || message === 'upload_too_large') return studioErrorResponse(new Error('studio_upload_missing'));
    return studioErrorResponse(error, 'La création n’a pas pu démarrer. Réessayez.');
  }
}
