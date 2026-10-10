import { NextRequest, NextResponse } from 'next/server';
import { notePrivilegedView, requireActivityJournalApi, resolveTenantView } from '@/lib/audit/access';
import { activityCriteria, parseActivityList } from '@/lib/audit/activityListParams';
import { AuditFeedUnavailable, buildFeedFilters, loadFeedPage } from '@/lib/audit/feed';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * GET /api/admin/activite — events of the journal, newest first, keyset cursor.
 * Same URL parameters as the page (+ `cursor_at`, `cursor_id`, `limit` ≤ 100).
 * audit.view (central map) + activity_journal gate; tenant from the server only.
 */
export async function GET(req: NextRequest) {
  const gate = await requireActivityJournalApi();
  if (!gate.ok) return gate.response;
  const params = req.nextUrl.searchParams;
  const values = parseActivityList(params);
  if (values.tab === 'security' && !gate.scope.canSeeSecurity) {
    return NextResponse.json({ error: 'Permission insuffisante.' }, { status: 403 });
  }
  const view = resolveTenantView(gate, values.tenant);
  const limit = Math.min(Math.max(Number.parseInt(params.get('limit') ?? '50', 10) || 50, 1), 100);
  const cursorAt = params.get('cursor_at');
  const cursorId = params.get('cursor_id');
  const cursor = cursorAt && cursorId && !Number.isNaN(Date.parse(cursorAt)) && /^[a-z]{2}:[0-9a-f-]{36}$/i.test(cursorId)
    ? { at: new Date(cursorAt).toISOString(), id: cursorId }
    : undefined;
  try {
    const events = await loadFeedPage(buildFeedFilters(gate.scope, view.tenants, { ...activityCriteria(values), cursor }), limit + 1);
    await notePrivilegedView(gate, view);
    const page = events.slice(0, limit);
    const last = page[page.length - 1];
    return NextResponse.json({
      events: page,
      nextCursor: events.length > limit && last ? { at: last.occurredAt, id: last.id } : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const notInstalled = error instanceof AuditFeedUnavailable && error.notInstalled;
    return NextResponse.json({ error: notInstalled ? 'Le journal n’est pas encore installé (migration 153).' : 'Lecture du journal impossible.' }, { status: 503 });
  }
}
