import { NextRequest, NextResponse } from 'next/server';
import { HELP_LOCALES, type HelpLocale } from '@/lib/helpCenter/domain';
import { helpPlatformApi, readJsonBody } from '@/lib/helpCenter/server/access';
import { helpErrorMessage, replaceContexts, saveTranslation, updateMetadata, validateArticleInput } from '@/lib/helpCenter/server/platformService';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/admin/platform/knowledge/articles/[id] — saves the working copy:
 * metadata, one language ({ locale, title, summary, blocks }) and/or the page
 * associations. Never publishes (see …/status). Platform owner only.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await helpPlatformApi();
  if (!guard.ok) return guard.response;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Introuvable.' }, { status: 404 });
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  try {
    if (body.metadata && typeof body.metadata === 'object') {
      const meta = body.metadata as Record<string, unknown>;
      const patch = {
        module: typeof meta.module === 'string' ? meta.module : undefined,
        minLevel: meta.minLevel === 'advanced' ? 'advanced' as const : meta.minLevel === 'standard' ? 'standard' as const : undefined,
        requiredPermission: typeof meta.requiredPermission === 'string' ? meta.requiredPermission : undefined,
        requiredFlag: typeof meta.requiredFlag === 'string' ? meta.requiredFlag : undefined,
        position: Number.isInteger(meta.position) ? Number(meta.position) : undefined,
      };
      const invalid = validateArticleInput(patch, false);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
      await updateMetadata(params.id, patch, guard.adminId);
    }
    if (body.translation && typeof body.translation === 'object') {
      const t = body.translation as Record<string, unknown>;
      if (!(HELP_LOCALES as readonly string[]).includes(String(t.locale))) return NextResponse.json({ error: 'Langue invalide.' }, { status: 400 });
      const result = await saveTranslation(params.id, t.locale as HelpLocale, String(t.title ?? ''), String(t.summary ?? ''), t.blocks ?? [], guard.adminId);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (Array.isArray(body.contexts)) {
      const result = await replaceContexts(params.id, body.contexts as Array<{ routePattern: string; action?: string | null; priority?: number }>);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: helpErrorMessage(error) }, { status: 409 });
  }
}
