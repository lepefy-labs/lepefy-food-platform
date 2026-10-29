import type { ContextKind } from './core/contextToken';

export interface AdminMailRow {
  id: string;
  role: string;
  tenant_id: string | null;
}

export interface AdminMailDeps {
  /** Tenant of the deployment the admin is logging in on (NEXT_PUBLIC_TENANT_SLUG), or null. */
  deploymentTenantId: () => Promise<string | null>;
  /** True when the user has admin access to that tenant (membership or legacy row), as the admin layout decides. */
  hasTenantAccess: (userId: string, tenantId: string) => Promise<boolean>;
}

/**
 * Which identity the admin login email carries. The admin signs in on a tenant's
 * deployment, so that tenant (checked for membership) wins over the legacy
 * `admin_users.tenant_id`, which can differ for users with several memberships.
 * Platform owners and users without a tenant get the neutral "Lepefy" identity.
 */
export async function resolveAdminMailIdentity(
  admin: AdminMailRow,
  deps: AdminMailDeps,
): Promise<{ tenantId: string | null; kind: Extract<ContextKind, 'admin' | 'platform'> }> {
  if (admin.role === 'platform_owner') return { tenantId: null, kind: 'platform' };

  const deployment = await deps.deploymentTenantId().catch(() => null);
  if (deployment && (await deps.hasTenantAccess(admin.id, deployment).catch(() => false))) {
    return { tenantId: deployment, kind: 'admin' };
  }
  return admin.tenant_id ? { tenantId: admin.tenant_id, kind: 'admin' } : { tenantId: null, kind: 'platform' };
}
