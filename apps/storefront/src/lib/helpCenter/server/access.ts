import 'server-only';
import { unstable_cache } from 'next/cache';
import { NextResponse } from 'next/server';
import { notFound } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { hasTenantFeature } from '@/lib/entitlements/tenantEntitlements';
import { getTenantServiceState } from '@/lib/billing/tenantServiceState';
import { getCurrentAdminAccessContext, requirePermission, type AdminAccessContext } from '@/lib/auth/adminRbac';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import type { Tenant } from '@lepefy/types';
import {
  HELP_DEFAULT_LOCALE, HELP_DISABLED_FLAG, HELP_FEATURE_ADVANCED, HELP_FEATURE_STANDARD, HELP_LOCALES, HELP_PERMISSION,
  type HelpLevel, type HelpLocale,
} from '../domain';
import { resolveHelpLevel } from '../rules';
import type { HelpViewer } from '../contextResolver';

/**
 * Guards of the Help Center. The tenant always comes from the deployment
 * (getTenant), never from the browser. The commercial level is resolved once,
 * centrally (rules.resolveHelpLevel); the capability is checked on every call.
 * Independent from Assistance: nothing here reads any Assistance switch.
 */

const ENTITLEMENT_CACHE_SECONDS = 60;

async function readEntitlements(tenantId: string): Promise<{ suspended: boolean; standard: boolean; advanced: boolean }> {
  const state = await getTenantServiceState(tenantId);
  const [standard, advanced] = await Promise.all([
    hasTenantFeature(tenantId, HELP_FEATURE_STANDARD),
    hasTenantFeature(tenantId, HELP_FEATURE_ADVANCED),
  ]);
  return { suspended: state.suspended, standard, advanced };
}

/** Commercial level of a tenant. Any read error fails closed (disabled). */
export async function getHelpLevel(tenantId: string): Promise<HelpLevel> {
  try {
    const adminDisabled = await isFeatureEnabled(tenantId, HELP_DISABLED_FLAG);
    if (adminDisabled) return 'disabled';
    const entitlements = await unstable_cache(() => readEntitlements(tenantId), ['help-center-entitlements', tenantId], {
      revalidate: ENTITLEMENT_CACHE_SECONDS,
      tags: [`help-center:${tenantId}`],
    })();
    return resolveHelpLevel({ ...entitlements, adminDisabled });
  } catch (error) {
    console.error('[help-center] entitlement read failed; failing closed:', tenantId, error);
    return 'disabled';
  }
}

export function normalizeHelpLocale(raw: unknown): HelpLocale {
  return typeof raw === 'string' && (HELP_LOCALES as readonly string[]).includes(raw) ? (raw as HelpLocale) : HELP_DEFAULT_LOCALE;
}

export function viewerFor(access: AdminAccessContext, level: HelpLevel, flags: ReadonlySet<string>): HelpViewer {
  return { level, permissions: new Set(access.permissions), flags, isPlatformOwner: access.isPlatformOwner };
}

export type HelpTenantAccess =
  | { ok: true; tenant: Tenant; access: AdminAccessContext; level: Exclude<HelpLevel, 'disabled'>; adminId: string }
  | { ok: false; response: NextResponse };

/** Tenant API guard: capability, then commercial level (404 when the module is off). */
export async function helpTenantApi(): Promise<HelpTenantAccess> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, HELP_PERMISSION);
  if (denied) return { ok: false, response: denied };
  const level = await getHelpLevel(tenant.id);
  if (level === 'disabled') return { ok: false, response: NextResponse.json({ error: 'Introuvable.' }, { status: 404 }) };
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access) return { ok: false, response: NextResponse.json({ error: 'Accès refusé.' }, { status: 403 }) };
  return { ok: true, tenant, access, level, adminId: access.userId };
}

/** Tenant pages: 404 when the module is off (the layout already checked the capability). */
export async function requireHelpTenantPage(): Promise<{ tenant: Tenant; access: AdminAccessContext; level: Exclude<HelpLevel, 'disabled'> }> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access || !access.permissions.includes(HELP_PERMISSION) && !access.isPlatformOwner) notFound();
  const level = await getHelpLevel(tenant.id);
  if (level === 'disabled') notFound();
  return { tenant, access, level };
}

export type HelpPlatformAccess =
  | { ok: true; adminId: string; access: AdminAccessContext }
  | { ok: false; response: NextResponse };

/** Console API guard: platform owner only. Absent from adminApiPermissions on purpose. */
export async function helpPlatformApi(): Promise<HelpPlatformAccess> {
  const denied = await requirePlatformOwner();
  if (denied) return { ok: false, response: denied };
  const access = await getCurrentAdminAccessContext(null);
  if (!access?.isPlatformOwner) return { ok: false, response: NextResponse.json({ error: 'Accès réservé au propriétaire de la plateforme.' }, { status: 403 }) };
  return { ok: true, adminId: access.userId, access };
}

export async function readJsonBody(request: Request, maxBytes = 120_000): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > maxBytes) return null;
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
