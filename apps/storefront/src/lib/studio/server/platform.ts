import 'server-only';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getCurrentAdminAccessContext, type AdminAccessContext } from '@/lib/auth/adminRbac';
import { adminActorLabel, registerRequestActor, REQUEST_ID_HEADER } from '@/lib/audit/requestContext';
import { STUDIO_FLAG } from '../domain';
import { quotaView } from '../rules';
import type { StudioQuotaView } from '../domain';

/**
 * Console plateforme « Studio images »: every tenant, its release flag, its
 * monthly quota/budget and this month's usage. Platform owner only; the flag
 * is written through the same `tenant_feature_flags` row as Paramètres ›
 * Fonctionnalités (audited by the 153 trigger), quotas through the 184 RPC.
 */

export interface PlatformStudioTenant {
  id: string;
  name: string;
  slug: string;
  isTest: boolean;
  enabled: boolean;
  quota: StudioQuotaView;
  retentionDays: number;
  customized: boolean;
  assets: number;
}

export async function loadPlatformStudio(): Promise<PlatformStudioTenant[]> {
  const db = createServiceClient();
  const [{ data: tenants, error }, { data: flags }, { data: settings }] = await Promise.all([
    db.from('tenants').select('id, name, slug, is_test').order('name', { ascending: true }).limit(500),
    db.from('tenant_feature_flags').select('tenant_id, enabled').eq('flag_key', STUDIO_FLAG),
    db.from('studio_tenant_settings').select('tenant_id, draft_retention_days'),
  ]);
  if (error) throw error;
  const enabled = new Map(((flags ?? []) as Array<{ tenant_id: string; enabled: boolean }>).map((row) => [row.tenant_id, row.enabled]));
  const retention = new Map(((settings ?? []) as Array<{ tenant_id: string; draft_retention_days: number }>).map((row) => [row.tenant_id, row.draft_retention_days]));
  const rows = (tenants ?? []) as Array<{ id: string; name: string; slug: string; is_test: boolean | null }>;
  return Promise.all(rows.map(async (tenant) => {
    const [{ data: summary }, { count }] = await Promise.all([
      db.rpc('studio_usage_summary', { p_tenant_id: tenant.id }),
      db.from('studio_assets').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).is('purged_at', null),
    ]);
    return {
      id: tenant.id, name: tenant.name, slug: tenant.slug, isTest: Boolean(tenant.is_test),
      enabled: enabled.get(tenant.id) === true,
      quota: quotaView(((summary ?? []) as Array<Record<string, number | string | null>>)[0] ?? null),
      retentionDays: retention.get(tenant.id) ?? 30,
      customized: retention.has(tenant.id),
      assets: count ?? 0,
    };
  }));
}

export type PlatformStudioAccess = { ok: true; access: AdminAccessContext } | { ok: false; response: NextResponse };

/** Platform-owner API guard; registers the actor for the audit triggers. */
export async function platformStudioApi(): Promise<PlatformStudioAccess> {
  const denied = await requirePlatformOwner();
  if (denied) return { ok: false, response: denied };
  const access = await getCurrentAdminAccessContext(null);
  if (!access?.isPlatformOwner) return { ok: false, response: NextResponse.json({ error: 'Accès réservé au propriétaire de la plateforme.' }, { status: 403 }) };
  const requestHeaders = headers();
  registerRequestActor(requestHeaders.get(REQUEST_ID_HEADER), {
    actorType: 'platform_owner', adminId: access.userId, label: adminActorLabel(access), ref: 'platform/studio-images', source: 'app',
  });
  return { ok: true, access };
}
