import { NextRequest, NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/helpCenter/rules';
import { helpTenantApi, normalizeHelpLocale } from '@/lib/helpCenter/server/access';
import { helpArticle } from '@/lib/helpCenter/server/service';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * GET /api/admin/help/articles/[slug] — one published guide. Unknown, draft,
 * archived, other-tenant and not-authorised guides all answer the same 404.
 */
export async function GET(request: NextRequest, { params }: { params: { slug: string } }) {
  const guard = await helpTenantApi();
  if (!guard.ok) return guard.response;
  const notFound = NextResponse.json({ error: 'Introuvable.' }, { status: 404 });
  if (!isValidSlug(params.slug)) return notFound;
  const found = await helpArticle(
    { tenantId: guard.tenant.id, access: guard.access, level: guard.level, locale: normalizeHelpLocale(request.nextUrl.searchParams.get('lang')) },
    params.slug,
  );
  if (!found) return notFound;
  return NextResponse.json(found, { headers: { 'Cache-Control': 'private, no-store' } });
}
