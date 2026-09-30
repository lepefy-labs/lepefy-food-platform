import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import type { Tenant } from '@lepefy/types';
import { getTenant } from '@/lib/tenant/getTenant';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { canAdmin, getCurrentAdminAccessContext, requirePermission, type AdminAccessContext } from '@/lib/auth/adminRbac';
import { getAdminId } from '@/lib/auth/getAdminId';
import { BUSINESS_MANAGEMENT_FLAG } from '@/lib/gestion/domain';

/**
 * Guard unico di Gestion du commerce (flag di rilascio `business_management`).
 * Fail-closed: flag assente, spento o illeggibile = modulo inesistente.
 * Nascondere la voce di menu non basta: ogni pagina chiama
 * requireBusinessManagementPage() e ogni API requireBusinessManagementApi().
 */

export function isBusinessManagementEnabled(tenantId: string): Promise<boolean> {
  return isFeatureEnabled(tenantId, BUSINESS_MANAGEMENT_FLAG);
}

async function currentTenant(): Promise<Tenant> {
  return getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? '');
}

export interface GestionPageContext {
  tenant: Tenant;
  access: AdminAccessContext;
  can: (permission: string) => boolean;
}

/** Pagine /admin/gestion/**: 404 se il flag è spento, redirect se manca la capability. */
export async function requireBusinessManagementPage(permissions: string | string[]): Promise<GestionPageContext> {
  const tenant = await currentTenant();
  if (!(await isBusinessManagementEnabled(tenant.id))) notFound();
  const access = await getCurrentAdminAccessContext(tenant.id);
  if (!access) redirect('/admin/login');
  if (!access.isPlatformOwner && access.tenantId !== tenant.id) redirect('/admin/login?error=unauthorized');
  const required = Array.isArray(permissions) ? permissions : [permissions];
  if (!required.some((permission) => canAdmin(access, permission))) redirect('/admin');
  return { tenant, access, can: (permission: string) => canAdmin(access, permission) };
}

export type GestionApiContext =
  | { ok: true; tenant: Tenant; actorId: string | null }
  | { ok: false; response: NextResponse };

/**
 * API /api/admin/gestion/**: 404 se il flag è spento, poi la capability della
 * mappa centrale (adminApiPermissions.ts) ed eventualmente una capability extra.
 */
export async function requireBusinessManagementApi(extraPermission?: string): Promise<GestionApiContext> {
  const tenant = await currentTenant();
  if (!(await isBusinessManagementEnabled(tenant.id))) {
    return { ok: false, response: NextResponse.json({ error: 'Module indisponible.' }, { status: 404 }) };
  }
  const denied = await requireAdmin(tenant.id);
  if (denied) return { ok: false, response: denied };
  if (extraPermission) {
    const extraDenied = await requirePermission(tenant.id, extraPermission);
    if (extraDenied) return { ok: false, response: extraDenied };
  }
  return { ok: true, tenant, actorId: await getAdminId() };
}
