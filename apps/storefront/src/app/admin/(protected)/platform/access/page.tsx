import { createServiceClient } from '@/lib/supabase/server';
import AccessControlClient, {
  type AccessMembership,
  type AccessPermission,
  type AccessRole,
  type AccessTenant,
  type AccessUser,
} from './AccessControlClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function PlatformAccessPage() {
  const service = createServiceClient();
  const [rolesResult, permissionsResult, rolePermissionsResult, membershipsResult, usersResult, tenantsResult] = await Promise.all([
    service.from('admin_roles').select('id, code, name, description, scope, is_system, active').order('scope').order('name'),
    service.from('admin_permissions').select('key, module, label, description, risk_level, position, active').eq('active', true).order('position'),
    service.from('admin_role_permissions').select('role_id, permission_key'),
    service.from('admin_memberships').select('id, user_id, tenant_id, role_id, active').eq('active', true),
    service.from('admin_users').select('id, email, first_name, last_name, nickname, active').eq('active', true).order('email'),
    service.from('tenants').select('id, name').order('name'),
  ]);

  const schemaReady = !rolesResult.error && !permissionsResult.error && !rolePermissionsResult.error && !membershipsResult.error;
  if (!schemaReady) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]">Plateforme · Accès &amp; sécurité</p>
        <h1 className="mt-1 text-xl font-semibold text-gray-950 dark:text-white">Rôles &amp; permissions</h1>
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          Le modèle RBAC nécessite la migration <strong>085_admin_rbac_permissions.sql</strong> avant d’être administrable.
        </div>
      </div>
    );
  }

  const permissionsByRole = new Map<string, string[]>();
  for (const row of rolePermissionsResult.data ?? []) {
    const list = permissionsByRole.get(row.role_id) ?? [];
    list.push(row.permission_key);
    permissionsByRole.set(row.role_id, list);
  }
  const membershipCountByRole = new Map<string, number>();
  for (const membership of membershipsResult.data ?? []) {
    membershipCountByRole.set(membership.role_id, (membershipCountByRole.get(membership.role_id) ?? 0) + 1);
  }
  const roleNameById = new Map((rolesResult.data ?? []).map((role) => [role.id, role.name]));

  const roles: AccessRole[] = (rolesResult.data ?? []).map((role) => ({
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description ?? '',
    scope: role.scope === 'platform' ? 'platform' : 'tenant',
    isSystem: Boolean(role.is_system),
    active: Boolean(role.active),
    permissionKeys: permissionsByRole.get(role.id) ?? [],
    userCount: membershipCountByRole.get(role.id) ?? 0,
  }));

  const permissions: AccessPermission[] = (permissionsResult.data ?? []).map((permission) => ({
    key: permission.key,
    module: permission.module,
    label: permission.label,
    description: permission.description ?? '',
    riskLevel: permission.risk_level === 'critical' ? 'critical' : permission.risk_level === 'sensitive' ? 'sensitive' : 'standard',
  }));

  const users: AccessUser[] = (usersResult.data ?? []).map((user) => ({
    id: user.id,
    email: user.email,
    displayName: user.nickname || [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email,
  }));
  const tenants: AccessTenant[] = (tenantsResult.data ?? []).map((tenant) => ({ id: tenant.id, name: tenant.name }));
  const memberships: AccessMembership[] = (membershipsResult.data ?? []).map((membership) => ({
    id: membership.id,
    userId: membership.user_id,
    tenantId: membership.tenant_id,
    roleId: membership.role_id,
    roleName: roleNameById.get(membership.role_id) ?? 'Rôle',
  }));

  return (
    <div className="mx-auto w-full max-w-6xl pb-12">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]">Plateforme · Accès &amp; sécurité</p>
          <h1 className="mt-1 text-xl font-semibold text-gray-950 dark:text-white">Rôles &amp; permissions</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">Composez des rôles tenant à partir des fonctionnalités réellement protégées par Lepefy. Les rôles système restent verrouillés.</p>
        </div>
        <span className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">{permissions.length} permissions cataloguées</span>
      </div>
      <AccessControlClient roles={roles} permissions={permissions} users={users} tenants={tenants} memberships={memberships} />
    </div>
  );
}
