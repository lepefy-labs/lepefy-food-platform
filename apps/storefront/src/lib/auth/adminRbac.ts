import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';

export interface AdminAccessContext {
  userId: string;
  email: string;
  legacyRole: string;
  tenantId: string | null;
  roleId: string | null;
  roleCode: string;
  roleName: string;
  scope: 'tenant' | 'platform';
  permissions: string[];
  isPlatformOwner: boolean;
  profileCompleted: boolean;
  firstName: string | null;
  lastName: string | null;
  nickname: string | null;
  rbacSource: 'dynamic' | 'legacy';
}

const LEGACY_TENANT_ADMIN_PERMISSIONS = [
  'orders.view','orders.manage','shop_payments.confirm','catalog.view','catalog.manage','shipping.view','shipping.manage','loyalty.manage','loyalty.scan','growth.manage','growth.payouts.manage','ai_knowledge.manage',
  'events.view','events.manage','event_reservations.view','event_reservations.manage','event_payments.view','event_payments.confirm','event_payments.cancel','event_payments.refund','event_content.manage',
  'scan.access','scan.search','scan.redeem','scan.metrics','scan.undo_own','scan.undo_any',
  'tenant_settings.view','tenant_settings.manage','billing.view','ai_usage.view',
];

const LEGACY_CASHIER_PERMISSIONS = ['loyalty.scan','scan.access','scan.search','scan.redeem','scan.metrics','scan.undo_own'];

export function canAdmin(context: AdminAccessContext, permission: string): boolean {
  if (context.isPlatformOwner) return true;
  // Tenant Admin is a protected system role whose product contract is full
  // tenant administration. Keep that invariant even when a newly deployed
  // capability has not yet been backfilled into admin_role_permissions.
  if (context.roleCode === 'tenant_admin' && !permission.startsWith('platform.')) return true;
  return context.permissions.includes(permission);
}

function legacyPermissions(role: string): string[] {
  if (role === 'tenant_admin') return LEGACY_TENANT_ADMIN_PERMISSIONS;
  if (role === 'tenant_cashier') return LEGACY_CASHIER_PERMISSIONS;
  if (role === 'platform_owner') return ['*'];
  return [];
}

export async function getAdminAccessContext(userId: string, tenantId: string | null): Promise<AdminAccessContext | null> {
  const service = createServiceClient();
  const { data: admin } = await service
    .from('admin_users')
    .select('id, email, role, tenant_id, active')
    .eq('id', userId)
    .eq('active', true)
    .maybeSingle();

  if (!admin) return null;

  // Profile columns were introduced with migration 085. Query separately so
  // deployments remain operational before that migration is applied.
  const { data: profile, error: profileError } = await service
    .from('admin_users')
    .select('first_name, last_name, nickname, profile_completed_at')
    .eq('id', userId)
    .maybeSingle();

  const profileCompleted = profileError ? true : Boolean(profile?.profile_completed_at);
  const firstName = profileError ? null : profile?.first_name ?? null;
  const lastName = profileError ? null : profile?.last_name ?? null;
  const nickname = profileError ? null : profile?.nickname ?? null;

  const membershipQuery = service
    .from('admin_memberships')
    .select('id, tenant_id, role_id, active')
    .eq('user_id', userId)
    .eq('active', true);

  if (tenantId) membershipQuery.eq('tenant_id', tenantId);
  else membershipQuery.is('tenant_id', null);

  const { data: membership, error: membershipError } = await membershipQuery.maybeSingle();

  if (!membershipError && membership) {
    const [{ data: role }, { data: rolePermissions }] = await Promise.all([
      service.from('admin_roles').select('id, code, name, scope, active').eq('id', membership.role_id).eq('active', true).maybeSingle(),
      service.from('admin_role_permissions').select('permission_key').eq('role_id', membership.role_id),
    ]);

    if (role) {
      return {
        userId: admin.id,
        email: admin.email,
        legacyRole: admin.role,
        tenantId: membership.tenant_id,
        roleId: role.id,
        roleCode: role.code,
        roleName: role.name,
        scope: role.scope === 'platform' ? 'platform' : 'tenant',
        permissions: (rolePermissions ?? []).map((row) => row.permission_key),
        isPlatformOwner: role.code === 'platform_owner',
        profileCompleted,
        firstName,
        lastName,
        nickname,
        rbacSource: 'dynamic',
      };
    }
  }

  // Progressive rollout fallback. Unknown dynamic roles deliberately receive
  // no legacy permissions rather than inheriting tenant_admin privileges.
  if (admin.role !== 'platform_owner' && tenantId && admin.tenant_id !== tenantId) return null;
  return {
    userId: admin.id,
    email: admin.email,
    legacyRole: admin.role,
    tenantId: admin.role === 'platform_owner' ? null : admin.tenant_id,
    roleId: null,
    roleCode: admin.role,
    roleName: admin.role,
    scope: admin.role === 'platform_owner' ? 'platform' : 'tenant',
    permissions: legacyPermissions(admin.role),
    isPlatformOwner: admin.role === 'platform_owner',
    profileCompleted,
    firstName,
    lastName,
    nickname,
    rbacSource: 'legacy',
  };
}

async function authenticatedUserId(): Promise<string | null> {
  const cookieStore = cookies();
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
        get(name: string) { return cookieStore.get(name)?.value; },
        set() {},
        remove() {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  );
  const { data: { user } } = await auth.auth.getUser();
  return user?.id ?? null;
}

export async function requirePermission(tenantId: string | null, permission: string): Promise<NextResponse | null> {
  const userId = await authenticatedUserId();
  if (!userId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

  // Platform owner is resolved through its global membership; other users
  // are resolved in the requested tenant.
  let context = await getAdminAccessContext(userId, tenantId);
  if (!context) context = await getAdminAccessContext(userId, null);
  if (!context) return NextResponse.json({ error: 'Accès refusé.' }, { status: 403 });
  if (!canAdmin(context, permission)) {
    return NextResponse.json({ error: 'Permission insuffisante.' }, { status: 403 });
  }
  if (!context.isPlatformOwner && context.tenantId !== tenantId) {
    return NextResponse.json({ error: 'Accès refusé pour ce tenant.' }, { status: 403 });
  }
  return null;
}

export async function getCurrentAdminAccessContext(tenantId: string | null): Promise<AdminAccessContext | null> {
  const userId = await authenticatedUserId();
  if (!userId) return null;
  return (await getAdminAccessContext(userId, tenantId)) ?? (await getAdminAccessContext(userId, null));
}
