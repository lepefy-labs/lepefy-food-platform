import { NextRequest, NextResponse } from 'next/server';
import { helpPlatformApi, readJsonBody } from '@/lib/helpCenter/server/access';
import { createArticle, helpErrorMessage, validateArticleInput } from '@/lib/helpCenter/server/platformService';
import { slugify } from '@/lib/helpCenter/rules';

export const dynamic = 'force-dynamic';

/** POST /api/admin/platform/knowledge/articles — new draft (French title, empty content). Platform owner only. */
export async function POST(request: NextRequest) {
  const guard = await helpPlatformApi();
  if (!guard.ok) return guard.response;
  const body = await readJsonBody(request, 10_000);
  if (!body) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 160) return NextResponse.json({ error: 'Titre requis (160 caractères maximum).' }, { status: 400 });
  const input = {
    slug: typeof body.slug === 'string' && body.slug ? body.slug : slugify(title),
    module: typeof body.module === 'string' ? body.module : 'general',
    minLevel: body.minLevel === 'advanced' ? 'advanced' as const : 'standard' as const,
    requiredPermission: typeof body.requiredPermission === 'string' && body.requiredPermission ? body.requiredPermission : null,
    requiredFlag: typeof body.requiredFlag === 'string' && body.requiredFlag ? body.requiredFlag : null,
    position: Number.isInteger(body.position) ? Number(body.position) : 100,
    // Tenant-specific articles are an explicit, isolated choice (a tenant uuid), never the default.
    tenantId: typeof body.tenantId === 'string' && /^[0-9a-f-]{36}$/i.test(body.tenantId) ? body.tenantId : null,
  };
  const invalid = validateArticleInput(input, true);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  try {
    const { id } = await createArticle(input, title, guard.adminId);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: helpErrorMessage(error) }, { status: 409 });
  }
}
