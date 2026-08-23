import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import AdminBlockAccent from '../../_components/ui/AdminBlockAccent';
import AdminPageHeader from '../../_components/ui/AdminPageHeader';
import TeamClient, { type AdminUserRow, type TenantOption } from './TeamClient';

export const dynamic = 'force-dynamic';

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

  const { data: admin } = await adminClient
    .from('admin_users')
    .select('id, role, active')
    .eq('id', user.id)
    .eq('active', true)
    .single();

  if (!admin || admin.role !== 'platform_owner') redirect('/admin');

  const { data: adminUsers } = await adminClient
    .from('admin_users')
    .select('id, email, role, tenant_id, active, invited_by, created_at')
    .order('created_at', { ascending: false });

  const { data: tenants } = await adminClient
    .from('tenants')
    .select('id, name')
    .order('name', { ascending: true });

  const tenantNameById = new Map((tenants ?? []).map((t) => [t.id, t.name]));
  const emailById = new Map((adminUsers ?? []).map((a) => [a.id, a.email]));

  const rows: AdminUserRow[] = (adminUsers ?? []).map((a) => ({
    id: a.id,
    email: a.email,
    role: a.role,
    tenantId: a.tenant_id,
    tenantName: a.tenant_id ? tenantNameById.get(a.tenant_id) ?? null : null,
    active: a.active,
    invitedByEmail: a.invited_by ? emailById.get(a.invited_by) ?? null : null,
    createdAt: a.created_at,
  }));

  const tenantOptions: TenantOption[] = (tenants ?? []).map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="mx-auto w-full max-w-5xl pb-10">
      <AdminPageHeader
        title="Équipe"
        description="Gérez les comptes administrateurs de la plateforme et leur rattachement aux boutiques."
        meta={`${rows.filter((row) => row.active).length} compte${rows.filter((row) => row.active).length !== 1 ? 's' : ''} actif${rows.filter((row) => row.active).length !== 1 ? 's' : ''}`}
      />

      <AdminBlockAccent tone="info">
        <TeamClient admins={rows} tenants={tenantOptions} currentAdminId={admin.id} />
      </AdminBlockAccent>
    </div>
  );
}
