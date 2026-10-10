import { NextRequest, NextResponse } from 'next/server';
import { requireActivityJournalApi, resolveTenantView } from '@/lib/audit/access';
import { AuditFeedUnavailable, loadFeedEvent } from '@/lib/audit/feed';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * GET /api/admin/activite/:id — one event (feed id, e.g. `ae:<uuid>`), read
 * inside the admin's tenant and modules only: another tenant's id is a 404.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireActivityJournalApi();
  if (!gate.ok) return gate.response;
  const view = resolveTenantView(gate, req.nextUrl.searchParams.get('tenant') ?? undefined);
  try {
    const event = await loadFeedEvent(gate.scope, view.tenants, decodeURIComponent(params.id));
    if (!event) return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });
    return NextResponse.json({ event }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const notInstalled = error instanceof AuditFeedUnavailable && error.notInstalled;
    return NextResponse.json({ error: notInstalled ? 'Le journal n’est pas encore installé (migration 153).' : 'Lecture du journal impossible.' }, { status: 503 });
  }
}
