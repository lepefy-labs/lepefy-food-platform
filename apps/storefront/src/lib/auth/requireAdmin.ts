import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { permissionForAdminApi } from '@/lib/auth/adminApiPermissions';
import { requirePermission } from '@/lib/auth/adminRbac';

export type AdminRole = 'platform_owner' | 'tenant_admin' | 'tenant_cashier';

/**
 * Compatibility guard for existing /api/admin handlers.
 *
 * Route handlers can keep calling requireAdmin() while authorization is now
 * capability-driven. The admin-only middleware forwards the request pathname
 * and method; this function resolves the canonical business permission and
 * delegates to requirePermission().
 *
 * `allowedRoles` remains in the signature only so existing callers compile.
 * It no longer grants access: RBAC membership + permissions are the source of
 * truth. Any legacy admin API missing from the central map fails closed.
 */
export async function requireAdmin(
  tenantId: string,
  _allowedRoles: AdminRole[] = ['tenant_admin'],
): Promise<NextResponse | null> {
  const requestHeaders = headers();
  const pathname = requestHeaders.get('x-lepefy-admin-path');
  const method = requestHeaders.get('x-lepefy-admin-method') ?? 'GET';

  if (!pathname || !pathname.startsWith('/api/admin/')) {
    return NextResponse.json(
      { error: 'Contexte d’autorisation administrateur indisponible.' },
      { status: 403 },
    );
  }

  const permission = permissionForAdminApi(pathname, method);
  if (!permission) {
    console.error('[admin-rbac] API admin non mappée:', method, pathname);
    return NextResponse.json(
      { error: 'Cette opération administrateur n’est pas encore associée à une permission.' },
      { status: 403 },
    );
  }

  return requirePermission(tenantId, permission);
}
