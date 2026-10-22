import 'server-only';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { getCurrentAdminAccessContext, requirePermission, type AdminAccessContext } from '@/lib/auth/adminRbac';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { registerRequestActor, REQUEST_ID_HEADER } from '@/lib/audit/requestContext';
import type { Tenant } from '@lepefy/types';
import { SUPPORT_FLAG, SUPPORT_PERMISSION } from '../domain';

/**
 * Guards of the Assistance module. The shop's tenant always comes from the
 * deployment (getTenant), never from the browser; the capability, the tenant
 * match and the release flag are checked on every call. Hiding the menu entry
 * is not the security control.
 */

export function isSupportEnabled(tenantId: string): Promise<boolean> {
  return isFeatureEnabled(tenantId, SUPPORT_FLAG);
}

/** Name kept with a message (« Chloé »), never the e-mail. */
export function supportActorLabel(access: Pick<AdminAccessContext, 'nickname' | 'firstName' | 'lastName'>): string | null {
  return (access.nickname || [access.firstName, access.lastName].filter(Boolean).join(' ') || '').trim().slice(0, 120) || null;
}

export type SupportTenantAccess =
  | { ok: true; tenant: Tenant; access: AdminAccessContext; adminId: string; label: string | null; isPlatformOwner: boolean }
  | { ok: false; response: NextResponse };

const notFoundResponse = () => NextResponse.json({ error: 'Introuvable.' }, { status: 404 });

/**
 * Shop API guard. `write: true` refuses the platform owner: a Lepefy message
 * is never written through the shop's form (no false attribution).
 */
export async function supportTenantApi({ write }: { write: boolean }): Promise<SupportTenantAccess> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, SUPPORT_PERMISSION);
  if (denied) return { ok: false, response: denied };
  if (!(await isSupportEnabled(tenant.id))) return { ok: false, response: notFoundResponse() };
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access) return { ok: false, response: NextResponse.json({ error: 'Accès refusé.' }, { status: 403 }) };
  if (write && access.isPlatformOwner) {
    return { ok: false, response: NextResponse.json({ error: 'Vous êtes connecté avec un compte Lepefy : répondez depuis la console « Assistance tenants ».' }, { status: 403 }) };
  }
  return { ok: true, tenant, access, adminId: access.userId, label: supportActorLabel(access), isPlatformOwner: access.isPlatformOwner };
}

/** Shop pages: 404 when the module is off (the layout already checked support.use). */
export async function requireSupportTenantPage(): Promise<{ tenant: Tenant; access: AdminAccessContext }> {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access || !(await isSupportEnabled(tenant.id))) notFound();
  return { tenant, access };
}

export type SupportPlatformAccess =
  | { ok: true; adminId: string; label: string | null; access: AdminAccessContext }
  | { ok: false; response: NextResponse };

/** Platform console API guard: platform owner only, on every tenant. */
export async function supportPlatformApi(): Promise<SupportPlatformAccess> {
  const denied = await requirePlatformOwner();
  if (denied) return { ok: false, response: denied };
  const access = await getCurrentAdminAccessContext(null);
  if (!access?.isPlatformOwner) return { ok: false, response: NextResponse.json({ error: 'Accès réservé au propriétaire de la plateforme.' }, { status: 403 }) };
  // Verified actor of this request for the audit triggers of the 163 RPCs.
  const requestHeaders = headers();
  registerRequestActor(requestHeaders.get(REQUEST_ID_HEADER), {
    actorType: 'platform_owner',
    adminId: access.userId,
    label: supportActorLabel(access) ?? 'Lepefy',
    ref: 'support',
    source: 'app',
  });
  return { ok: true, adminId: access.userId, label: supportActorLabel(access), access };
}

/** Request body as an object, or null (invalid JSON, wrong type, too large). */
export async function readJsonBody(request: Request, maxBytes = 32_000): Promise<Record<string, unknown> | null> {
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
