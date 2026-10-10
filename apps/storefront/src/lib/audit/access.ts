import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import type { Tenant } from '@lepefy/types';
import { getTenant } from '@/lib/tenant/getTenant';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { canAdmin, getCurrentAdminAccessContext, type AdminAccessContext } from '@/lib/auth/adminRbac';
import { BUSINESS_MANAGEMENT_FLAG } from '@/lib/gestion/domain';
import { ACTIVITY_JOURNAL_FLAG, resolveJournalScope, type JournalScope } from './scope';
import type { FeedTenantScope } from './feed';
import { recordAuditEvent } from './recordAuditEvent';

/**
 * Guard unico del Journal d'activité (docs/ADMIN_ACTIVITY_AUDIT.md §6).
 * Platform owner: sempre. Tenant: flag `activity_journal` (attivabile solo dal
 * platform owner) + capability `audit.view`. Il tenant viene solo da getTenant().
 */

async function currentTenant(): Promise<Tenant> {
  return getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? '');
}

export function isActivityJournalEnabled(tenantId: string): Promise<boolean> {
  return isFeatureEnabled(tenantId, ACTIVITY_JOURNAL_FLAG);
}

async function scopeFor(tenant: Tenant, access: AdminAccessContext): Promise<JournalScope> {
  const [gestion, whatsapp] = await Promise.all([
    isFeatureEnabled(tenant.id, BUSINESS_MANAGEMENT_FLAG),
    isFeatureEnabled(tenant.id, 'whatsapp_business'),
  ]);
  return resolveJournalScope({
    isPlatformOwner: access.isPlatformOwner,
    can: (permission) => canAdmin(access, permission),
    flags: { business_management: gestion, whatsapp_business: whatsapp },
  });
}

export interface JournalContext {
  tenant: Tenant;
  access: AdminAccessContext;
  scope: JournalScope;
}

/** Can this admin open the journal of the current tenant? (UX hint for links and timelines.) */
export async function journalAvailable(tenant: Tenant, access: AdminAccessContext | null): Promise<boolean> {
  if (!access) return false;
  if (access.isPlatformOwner) return true;
  return canAdmin(access, 'audit.view') && (await isActivityJournalEnabled(tenant.id));
}

/** Pages /admin/activite: 404 when the tenant has no access, redirect without the capability. */
export async function requireActivityJournalPage(): Promise<JournalContext> {
  const tenant = await currentTenant();
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access) redirect('/admin/login');
  if (!access.isPlatformOwner) {
    if (access.tenantId !== tenant.id) redirect('/admin/login?error=unauthorized');
    if (!(await isActivityJournalEnabled(tenant.id))) notFound();
    if (!canAdmin(access, 'audit.view')) redirect('/admin');
  }
  return { tenant, access, scope: await scopeFor(tenant, access) };
}

export type JournalApiContext = ({ ok: true } & JournalContext) | { ok: false; response: NextResponse };

/** APIs /api/admin/activite/**: capability from the central map, then the tenant gate. */
export async function requireActivityJournalApi(): Promise<JournalApiContext> {
  const tenant = await currentTenant();
  const denied = await requireAdmin(tenant.id);
  if (denied) return { ok: false, response: denied };
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access) return { ok: false, response: NextResponse.json({ error: 'Non authentifié.' }, { status: 401 }) };
  if (!access.isPlatformOwner && !(await isActivityJournalEnabled(tenant.id))) {
    return { ok: false, response: NextResponse.json({ error: 'Module indisponible.' }, { status: 404 }) };
  }
  return { ok: true, tenant, access, scope: await scopeFor(tenant, access) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface JournalTenantView {
  tenants: FeedTenantScope;
  /** Tenant shown (null = every tenant, platform view). */
  tenantId: string | null;
}

/**
 * Perimeter of the request. Only the platform owner may pick another tenant or
 * `all`; for everyone else the parameter is ignored (current tenant only).
 */
export function resolveTenantView(context: JournalContext, tenantParam: string | undefined): JournalTenantView {
  if (context.scope.canSeePlatform && tenantParam === 'all') return { tenants: { allTenants: true }, tenantId: null };
  if (context.scope.canSeePlatform && tenantParam && UUID.test(tenantParam)) return { tenants: { tenantIds: [tenantParam] }, tenantId: tenantParam };
  return { tenants: { tenantIds: [context.tenant.id] }, tenantId: context.tenant.id };
}

/**
 * Privileged access is itself audited: a platform owner reading a tenant's
 * journal (or all of them) leaves one event per perimeter and day.
 */
export async function notePrivilegedView(context: JournalContext, view: JournalTenantView): Promise<void> {
  if (!context.access.isPlatformOwner) return;
  const day = new Date().toISOString().slice(0, 10);
  await recordAuditEvent({
    tenantId: view.tenantId,
    eventType: 'audit.journal.cross_tenant_viewed',
    actor: context.access,
    resourceType: 'tenant',
    resourceId: view.tenantId ?? undefined,
    metadata: { perimeter: view.tenantId ? 'tenant' : 'all_tenants' },
    eventKey: `view:${context.access.userId}:${view.tenantId ?? 'all'}:${day}`,
  });
}

/** Contextual timelines: same gate + the host page's own permission. Never throws. */
export async function resourceTimelineScope(tenant: Tenant, hostPermission: string): Promise<JournalScope | null> {
  try {
    const access = await getCurrentAdminAccessContext(tenant.id);
    if (!access || !canAdmin(access, hostPermission) || !(await journalAvailable(tenant, access))) return null;
    return await scopeFor(tenant, access);
  } catch {
    return null;
  }
}
