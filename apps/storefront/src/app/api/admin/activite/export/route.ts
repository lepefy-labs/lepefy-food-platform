import { NextRequest, NextResponse } from 'next/server';
import { requireActivityJournalApi, resolveTenantView } from '@/lib/audit/access';
import { ACTIVITY_EXPORT_LIMIT, activityCriteria, parseActivityList } from '@/lib/audit/activityListParams';
import { buildActivityCsv } from '@/lib/audit/auditCsv';
import { AuditFeedUnavailable, buildFeedFilters, loadFeedPage, type AuditEventView } from '@/lib/audit/feed';
import { recordAuditEvent } from '@/lib/audit/recordAuditEvent';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

const BATCH = 500;

/**
 * GET /api/admin/activite/export — CSV of the filtered journal (same URL state
 * as the page). audit.export; security events only with audit.security.view;
 * max 5 000 rows (`X-Export-Truncated`). Every export is itself audited.
 */
export async function GET(req: NextRequest) {
  const gate = await requireActivityJournalApi();
  if (!gate.ok) return gate.response;
  if (!gate.scope.canExport) return NextResponse.json({ error: 'Permission insuffisante.' }, { status: 403 });
  const values = parseActivityList(req.nextUrl.searchParams);
  if (values.tab === 'security' && !gate.scope.canSeeSecurity) {
    return NextResponse.json({ error: 'Permission insuffisante.' }, { status: 403 });
  }
  const view = resolveTenantView(gate, values.tenant);
  const criteria = activityCriteria(values);

  const events: AuditEventView[] = [];
  let truncated = false;
  try {
    let cursor: { at: string; id: string } | undefined;
    while (events.length < ACTIVITY_EXPORT_LIMIT) {
      const batch = await loadFeedPage(buildFeedFilters(gate.scope, view.tenants, { ...criteria, cursor }), BATCH);
      events.push(...batch);
      const last = batch[batch.length - 1];
      if (batch.length < BATCH || !last) break;
      cursor = { at: last.occurredAt, id: last.id };
    }
    if (events.length > ACTIVITY_EXPORT_LIMIT) { events.length = ACTIVITY_EXPORT_LIMIT; truncated = true; }
    if (events.length === ACTIVITY_EXPORT_LIMIT && !truncated) {
      const more = await loadFeedPage(buildFeedFilters(gate.scope, view.tenants, {
        ...criteria, cursor: { at: events[events.length - 1]!.occurredAt, id: events[events.length - 1]!.id },
      }), 1);
      truncated = more.length > 0;
    }
  } catch (error) {
    const notInstalled = error instanceof AuditFeedUnavailable && error.notInstalled;
    return NextResponse.json({ error: notInstalled ? 'Le journal n’est pas encore installé (migration 153).' : 'Export impossible.' }, { status: 503 });
  }

  let tenantNames: Map<string, string> | undefined;
  if (view.tenantId === null) {
    const { data } = await createServiceClient().from('tenants').select('id, name');
    tenantNames = new Map(((data ?? []) as { id: string; name: string }[]).map((tenant) => [tenant.id, tenant.name]));
  }

  await recordAuditEvent({
    tenantId: view.tenantId,
    eventType: 'audit.export.generated',
    actor: gate.access,
    resourceType: 'audit_export',
    metadata: {
      rows: events.length, truncated, tab: values.tab, period: values.period, module: values.module ?? null,
      outcome: values.outcome ?? null, perimeter: view.tenantId ? 'tenant' : 'all_tenants',
    },
  });

  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(buildActivityCsv(events, { withTenant: tenantNames }), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="journal-activite-${day}.csv"`,
      'Cache-Control': 'no-store',
      'X-Export-Rows': String(events.length),
      'X-Export-Truncated': truncated ? 'true' : 'false',
    },
  });
}
