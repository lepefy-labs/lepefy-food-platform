import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { setFeatureFlag } from '@/lib/featureFlags/featureFlags';
import { recordAuditEvent } from '@/lib/audit/recordAuditEvent';
import { loadPlatformStudio, platformStudioApi } from '@/lib/studio/server/platform';
import { readJson } from '@/lib/studio/server/access';
import { STUDIO_FLAG } from '@/lib/studio/domain';
import { isUuid } from '@/lib/studio/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/** GET — every tenant with its Studio flag, quotas and month usage (platform owner). */
export async function GET() {
  const guard = await platformStudioApi();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ tenants: await loadPlatformStudio() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Lecture impossible (migration 183 appliquée ?).' }, { status: 500 });
  }
}

/**
 * PATCH — `{ tenantId, enabled }` switches the release flag of that tenant
 * (same row as Paramètres › Fonctionnalités, audited by trigger); `{ tenantId,
 * monthlyRevisions, monthlyBudgetUsd, retentionDays }` saves its quotas (184).
 * Other deployments see the flag change within the 30 s flag cache.
 */
export async function PATCH(request: NextRequest) {
  const guard = await platformStudioApi();
  if (!guard.ok) return guard.response;
  const body = await readJson(request);
  if (!body || !isUuid(body.tenantId)) return NextResponse.json({ error: 'Tenant invalide.' }, { status: 400 });
  const db = createServiceClient();
  const { data: tenant } = await db.from('tenants').select('id, name').eq('id', body.tenantId).maybeSingle();
  if (!tenant) return NextResponse.json({ error: 'Tenant introuvable.' }, { status: 404 });
  try {
    if (typeof body.enabled === 'boolean') {
      await setFeatureFlag(tenant.id, STUDIO_FLAG, body.enabled);
    }
    if (body.monthlyRevisions !== undefined || body.monthlyBudgetUsd !== undefined || body.retentionDays !== undefined) {
      const revisions = Number(body.monthlyRevisions);
      const budget = Number(body.monthlyBudgetUsd);
      const retention = Number(body.retentionDays);
      if (!Number.isInteger(revisions) || !Number.isFinite(budget) || !Number.isInteger(retention)) {
        return NextResponse.json({ error: 'Valeurs invalides.' }, { status: 400 });
      }
      const { error } = await db.rpc('studio_set_tenant_settings', {
        p_tenant_id: tenant.id, p_monthly_revisions: revisions, p_monthly_budget_usd: budget, p_draft_retention_days: retention,
      });
      if (error) {
        if (/studio_invalid_request/.test(error.message)) {
          return NextResponse.json({ error: 'Créations : 0 à 5 000 · budget : 0 à 10 000 USD · conservation : 7 à 365 jours.' }, { status: 400 });
        }
        if (['42883', 'PGRST202'].includes(error.code ?? '')) return NextResponse.json({ error: 'Migration 184 non appliquée.' }, { status: 503 });
        throw error;
      }
      await recordAuditEvent({
        tenantId: tenant.id, eventType: 'studio.settings.updated', actor: guard.access, resourceType: 'studio_settings',
        resourceLabel: tenant.name, metadata: { monthly_revisions: revisions, monthly_budget_usd: budget, draft_retention_days: retention },
      });
    }
    const tenants = await loadPlatformStudio();
    return NextResponse.json({ tenant: tenants.find((row) => row.id === tenant.id) ?? null });
  } catch (error) {
    console.error('[platform/studio-images] update failed', tenant.id, (error as { code?: string })?.code ?? '');
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }
}
