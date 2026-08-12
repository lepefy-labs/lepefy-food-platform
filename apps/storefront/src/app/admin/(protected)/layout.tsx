import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import Image from 'next/image';
import { createServerClient } from '@supabase/ssr';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import LogoutButton from '../LogoutButton';
import AdminSidebar from '../_components/AdminSidebar';
import AdminMobileNav from '../_components/AdminMobileNav';
import AdminThemeProvider from '../_components/AdminThemeProvider';
import ThemeToggleButton from '../_components/ThemeToggleButton';
import NotificationBell from '../_components/ui/NotificationBell';

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

  if (!user) {
    redirect('/admin/login');
  }

  const slug      = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant    = await getTenant(slug);
  const adminClient  = createServiceClient();

  // admin_users n'a aucune policy publique (service_role uniquement) — même
  // mécanisme que requireAdmin.ts (lib/auth/requireAdmin.ts), pour ne jamais
  // avoir deux sources de vérité sur les permissions admin.
  const { data: admin } = await adminClient
    .from('admin_users')
    .select('id, role, tenant_id, active')
    .eq('id', user.id)
    .eq('active', true)
    .single();

  if (!admin) {
    redirect('/admin/login?error=unauthorized');
  }

  // platform_owner (tenant_id null) a un accès global, invariant. Tout autre
  // rôle — tenant_admin ET tenant_cashier (047) — est scoped à son tenant.
  if (admin.role !== 'platform_owner' && admin.tenant_id !== tenant.id) {
    redirect('/admin/login?error=unauthorized');
  }

  // tenant_cashier (047) n'a accès qu'à /admin/loyalty/scan (route hors de ce
  // groupe protégé, avec sa propre vérification de rôle) — jamais au tableau
  // de bord, aux commandes, au catalogue, etc. rendus par ce layout partagé.
  // Point d'intervention minimal : un redirect ici évite d'avoir à masquer
  // conditionnellement chaque section de AdminSidebar/AdminMobileNav.
  if (admin.role === 'tenant_cashier') {
    redirect('/admin/loyalty/scan');
  }

  const { data: categories } = await adminClient
    .from('categories')
    .select('id, name, slug')
    .eq('tenant_id', tenant.id)
    .order('position');

  // Badge sidebar "Commandes" — Phase 1 lien externe (voir PendingPaymentsBanner).
  const { count: pendingPaymentsCount } = await adminClient
    .from('checkout_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('payment_method', 'external_link');

  // Badge sidebar "Événements" — Phase 2 lien externe, agrégé tous événements
  // (même mécanisme que le badge "Commandes" ci-dessus).
  const { count: pendingEventRequestsCount } = await adminClient
    .from('event_reservation_requests')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('status', 'pending');

  // Badge sidebar "Réservations matériel" — Phase 3 lien externe, agrégé
  // tous services (même mécanisme que les deux badges ci-dessus).
  const { count: pendingRentalRequestsCount } = await adminClient
    .from('rental_reservation_requests')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('status', 'pending');

  return (
    <AdminThemeProvider>
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-3 md:px-6 py-3 flex items-center gap-3 sticky top-0 z-10">
        <Suspense fallback={<div className="w-9 h-9 md:hidden" />}>
          <AdminMobileNav categories={categories ?? []} />
        </Suspense>
        {tenant.logo_url && (
          <Image
            src={tenant.logo_url}
            alt={tenant.name}
            width={140}
            height={32}
            className="h-8 w-auto object-contain"
            priority
          />
        )}
        <div>
          <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">{tenant.name}</span>
          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">
            Administration
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell />
          <ThemeToggleButton />
          <LogoutButton />
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-57px)] bg-gray-50 dark:bg-gray-950">
        <aside className="w-56 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 px-3 py-2 shrink-0 hidden md:block">
          <Suspense fallback={<div className="w-56 h-full" />}>
            <AdminSidebar
              categories={categories ?? []}
              pendingPaymentsCount={pendingPaymentsCount ?? 0}
              pendingEventRequestsCount={pendingEventRequestsCount ?? 0}
              pendingRentalRequestsCount={pendingRentalRequestsCount ?? 0}
            />
          </Suspense>
        </aside>
        <main className="flex-1 p-6 min-w-0">{children}</main>
      </div>
    </AdminThemeProvider>
  );
}
