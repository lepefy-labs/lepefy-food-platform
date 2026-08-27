import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import AdminBlockAccent from '../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import TeamClient, { type AdminUserRow, type RoleOption, type TenantOption } from './TeamClient';

export const dynamic = 'force-dynamic';

const LEGACY_ROLES: RoleOption[] = [
  { id: 'legacy:platform_owner', code: 'platform_owner', name: 'Propriétaire plateforme', scope: 'platform', isSystem: true },
  { id: 'legacy:tenant_admin', code: 'tenant_admin', name: 'Administrateur tenant', scope: 'tenant', isSystem: true },
  { id: 'legacy:tenant_cashier', code: 'tenant_cashier', name: 'Caissier', scope: 'tenant', isSystem: true },
];

export default async function TeamPage() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
        get(name: string) { return cookieStore.get(name)?.value },
        set() {},
        remove() {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/admin/login');

  const adminClient = createServiceClient();
  const { data: admin } = await adminClient.from('admin_users').select('id, role, active').eq('id', user.id).eq('active', true).single();
  if (!admin || admin.role !== 'platform_owner') redirect('/admin');

  const [{ data: adminUsers }, { data: tenants }, rolesResult, membershipsResult, profilesResult] = await Promise.all([
    adminClient.from('admin_users').select('id, email, role, tenant_id, active, invited_by, created_at').order('created_at', { ascending: false }),
    adminClient.from('tenants').select('id, name').order('name', { ascending: true }),
    adminClient.from('admin_roles').select('id, code, name, scope, is_system, active').eq('active', true).order('scope').order('name'),
    adminClient.from('admin_memberships').select('user_id, tenant_id, role_id, active').eq('active', true),
    adminClient.from('admin_users').select('id, first_name, last_name, nickname, profile_completed_at'),
  ]);

  const tenantNameById = new Map((tenants ?? []).map((tenant) => [tenant.id, tenant.name]));
  const emailById = new Map((adminUsers ?? []).map((entry) => [entry.id, entry.email]));
  const dynamicRoles: RoleOption[] = rolesResult.error
    ? LEGACY_ROLES
    : (rolesResult.data ?? []).map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
        scope: role.scope === 'platform' ? 'platform' : 'tenant',
        isSystem: Boolean(role.is_system),
      }));
  const roleById = new Map(dynamicRoles.map((role) => [role.id, role]));
  const roleByCode = new Map(dynamicRoles.map((role) => [role.code, role]));
  const membershipByUser = new Map<string, { tenant_id: string | null; role_id: string }>();
  if (!membershipsResult.error) {
    for (const membership of membershipsResult.data ?? []) {
      const current = membershipByUser.get(membership.user_id);
      if (!current || membership.tenant_id !== null) membershipByUser.set(membership.user_id, membership);
    }
  }
  const profileByUser = new Map<string, { first_name?: string | null; last_name?: string | null; nickname?: string | null; profile_completed_at?: string | null }>();
  if (!profilesResult.error) for (const profile of profilesResult.data ?? []) profileByUser.set(profile.id, profile);

  const rows: AdminUserRow[] = (adminUsers ?? []).map((entry) => {
    const membership = membershipByUser.get(entry.id);
    const role = membership ? roleById.get(membership.role_id) : roleByCode.get(entry.role);
    const tenantId = membership?.tenant_id ?? entry.tenant_id ?? null;
    const profile = profileByUser.get(entry.id);
    const displayName = profile?.nickname || [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || entry.email;
    return {
      id: entry.id,
      email: entry.email,
      displayName,
      roleCode: role?.code ?? entry.role,
      roleName: role?.name ?? entry.role,
      tenantId,
      tenantName: tenantId ? tenantNameById.get(tenantId) ?? null : null,
      active: entry.active,
      profileCompleted: profilesResult.error ? true : Boolean(profile?.profile_completed_at),
      invitedByEmail: entry.invited_by ? emailById.get(entry.invited_by) ?? null : null,
      createdAt: entry.created_at,
    };
  });

  const tenantOptions: TenantOption[] = (tenants ?? []).map((tenant) => ({ id: tenant.id, name: tenant.name }));

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Utilisateurs"
        description="Créez les accès administrateurs et affectez-les à un rôle. Les permissions détaillées se gèrent dans Rôles & permissions."
        meta={`${rows.filter((row) => row.active).length} compte${rows.filter((row) => row.active).length !== 1 ? 's' : ''} actif${rows.filter((row) => row.active).length !== 1 ? 's' : ''}`}
      />
      <AdminBlockAccent tone="info">
        <TeamClient admins={rows} tenants={tenantOptions} roles={dynamicRoles} currentAdminId={admin.id} />
      </AdminBlockAccent>
    </div>
  );
}
