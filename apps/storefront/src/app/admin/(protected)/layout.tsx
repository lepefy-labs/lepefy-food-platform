import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { createServerClient } from '@supabase/ssr';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import AdminSidebar from '../_components/AdminSidebar';
import AdminHeader from '../_components/AdminHeader';
import AdminThemeProvider from '../_components/AdminThemeProvider';

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();

  // Provide both old (get/set/remove) and new (getAll/setAll) cookie APIs.
  // @supabase/ssr@0.3.x reads cookies via get(name) internally, not getAll().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/admin/login');

  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const adminClient = createServiceClient();

  const { data: admin } = await adminClient
    .from('admin_users')
    .select('id, role, tenant_id, active')
    .eq('id', user.id)
    .eq('active', true)
    .single();

  if (!admin) redirect('/admin/login?error=unauthorized');
  if (admin.role !== 'platform_owner' && admin.tenant_id !== tenant.id) redirect('/admin/login?error=unauthorized');
  if (admin.role === 'tenant_cashier') redirect('/admin/loyalty/scan');

  const { data: categories } = await adminClient
    .from('categories')
    .select('id, name, slug')
    .eq('tenant_id', tenant.id)
    .order('position');

  const [
    pendingPaymentsResult,
    pendingEventRequestsResult,
    pendingRentalRequestsResult,
    newInquiriesResult,
  ] = await Promise.all([
    adminClient
      .from('checkout_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('payment_method', 'external_link'),
    adminClient
      .from('event_reservation_requests')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('status', 'pending'),
    adminClient
      .from('rental_reservation_requests')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('status', 'pending'),
    adminClient
      .from('service_inquiries')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('status', 'nouveau'),
  ]);

  return (
    <AdminThemeProvider>
      <AdminHeader
        tenantName={tenant.name}
        tenantLogoUrl={tenant.logo_url}
        categories={categories ?? []}
        isPlatformOwner={admin.role === 'platform_owner'}
        adminEmail={user.email ?? ''}
      />

      <div className="flex min-h-[calc(100vh-57px)] bg-gray-50 dark:bg-gray-950">
        <aside className="w-56 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 px-3 py-2 shrink-0 hidden md:block">
          <Suspense fallback={<div className="w-56 h-full" />}>
            <AdminSidebar
              categories={categories ?? []}
              pendingPaymentsCount={pendingPaymentsResult.count ?? 0}
              pendingEventRequestsCount={pendingEventRequestsResult.count ?? 0}
              pendingRentalRequestsCount={pendingRentalRequestsResult.count ?? 0}
              newInquiriesCount={newInquiriesResult.count ?? 0}
              isPlatformOwner={admin.role === 'platform_owner'}
            />
          </Suspense>
        </aside>
        <main className="flex-1 p-6 min-w-0">{children}</main>
      </div>
    </AdminThemeProvider>
  );
}
