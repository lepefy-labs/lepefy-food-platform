import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import LogoutButton from '../../LogoutButton';
import { ScanClient } from './ScanClient';

// Route volontairement HORS du groupe admin/(protected) — ce groupe redirige
// tout tenant_cashier vers cette page (voir (protected)/layout.tsx), donc
// cette page a besoin de sa PROPRE vérification d'accès, distincte de celle
// du layout partagé (qui n'admet que platform_owner/tenant_admin). Même
// pattern de cookies que requireAdmin.ts / (protected)/layout.tsx.
export const dynamic = 'force-dynamic';

export default async function LoyaltyScanPage() {
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

  const slug        = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant       = await getTenant(slug);
  const adminClient  = createServiceClient();

  const { data: admin } = await adminClient
    .from('admin_users')
    .select('id, role, tenant_id, active')
    .eq('id', user.id)
    .eq('active', true)
    .single();

  if (!admin) redirect('/admin/login?error=unauthorized');
  if (admin.role !== 'platform_owner' && admin.tenant_id !== tenant.id) {
    redirect('/admin/login?error=unauthorized');
  }
  if (!['platform_owner', 'tenant_admin', 'tenant_cashier'].includes(admin.role)) {
    redirect('/admin/login?error=unauthorized');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        {tenant.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tenant.logo_url} alt={tenant.name} className="h-8 w-auto object-contain" />
        )}
        <div>
          <span className="font-bold text-gray-900 text-sm">{tenant.name}</span>
          <span className="ml-2 text-xs text-gray-500 font-medium uppercase tracking-wide">
            Scan fidélité
          </span>
        </div>
        <div className="ml-auto">
          <LogoutButton />
        </div>
      </header>

      <main className="px-4 py-6 max-w-md mx-auto">
        <ScanClient tenantId={tenant.id} loyaltyEnabled={tenant.loyalty_enabled} />
      </main>
    </div>
  );
}
