import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { createServerClient } from '@supabase/ssr';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { getPlatformBranding } from '@/lib/admin/platformBranding';
import { getAdminWorkspaceUrls, resolveAdminWorkspace } from '@/lib/admin/workspace';
import { canAdmin, getAdminAccessContext } from '@/lib/auth/adminRbac';
import { defaultAdminDestination, isPersonalAdminPath, permissionsForAdminPath } from '@/lib/auth/adminRoutePermissions';
import { isBusinessManagementEnabled } from '@/lib/gestion/featureGate';
import { GESTION_VIEW_PERMISSIONS } from '@/lib/gestion/domain';
import { isWhatsAppEnabled } from '@/lib/whatsapp/server/featureGate';
import AdminSidebar from '../_components/AdminSidebar';
import AdminHeader from '../_components/AdminHeader';
import AdminThemeProvider from '../_components/AdminThemeProvider';
import SubscriptionBanner from '../_components/SubscriptionBanner';
import { getTenantServiceState } from '@/lib/billing/tenantServiceState';
import { SUSPENDED_ADMIN_PERMISSIONS, isAdminPathAllowedWhenSuspended } from '@/lib/billing/subscriptionRules';

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const requestHeaders = headers();
  const workspace = resolveAdminWorkspace(requestHeaders.get('host'));
  const requestedPath = requestHeaders.get('x-admin-path') ?? '/admin';
  const supabase = createServerClient(
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/admin/login');

  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const [tenant, platform] = await Promise.all([getTenant(slug), getPlatformBranding()]);
  const workspaceUrls = getAdminWorkspaceUrls(tenant);
  const access = (await getAdminAccessContext(user.id, tenant.id)) ?? (await getAdminAccessContext(user.id, null));
  if (!access) redirect('/admin/login?error=unauthorized');
  if (!access.profileCompleted) redirect(`/admin/onboarding?next=${encodeURIComponent(requestedPath)}`);

  const personalPath = isPersonalAdminPath(requestedPath);
  const requiredPermissions = permissionsForAdminPath(requestedPath, workspace);
  const requiredPermission = requiredPermissions?.[0] ?? null;
  if (!personalPath && requiredPermissions && !requiredPermissions.some((permission) => canAdmin(access, permission))) {
    const destination = defaultAdminDestination(access.permissions, workspace);
    if (!destination) redirect('/admin/login?error=unauthorized');
    redirect(destination);
  }
  // Unknown business pages remain available to the protected legacy tenant_admin
  // during progressive migration, while custom roles fail closed. Personal
  // account/security pages are always available to an authenticated admin.
  if (!personalPath && !requiredPermission && !access.isPlatformOwner && access.roleCode !== 'tenant_admin') {
    const destination = defaultAdminDestination(access.permissions, workspace);
    if (!destination) redirect('/admin/login?error=unauthorized');
    redirect(destination);
  }

  // Suspended tenant: its team keeps billing and read-only orders (the APIs
  // enforce the same rule in requirePermission). The platform owner is never limited.
  const serviceState = await getTenantServiceState(tenant.id);
  const limitedBySuspension = serviceState.suspended && !access.isPlatformOwner;
  if (limitedBySuspension && !isAdminPathAllowedWhenSuspended(requestedPath)) redirect('/admin/billing');
  const navPermissions = limitedBySuspension
    ? access.permissions.filter((permission) => (SUSPENDED_ADMIN_PERMISSIONS as readonly string[]).includes(permission))
    : access.permissions;

  const adminClient = createServiceClient();
  const [{ data: categories }, pendingPaymentsResult, pendingEventRequestsResult, pendingRentalRequestsResult, newInquiriesResult] = await Promise.all([
    adminClient.from('categories').select('id, name, slug').eq('tenant_id', tenant.id).order('position'),
    adminClient.from('checkout_sessions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('payment_method', 'external_link').in('status', ['open', 'expired', 'awaiting_verification']).is('order_id', null),
    adminClient.from('event_reservation_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'pending'),
    adminClient.from('rental_reservation_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'pending'),
    adminClient.from('service_inquiries').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'nouveau'),
  ]);
  // Gestion: il flag viene letto solo se l'admin potrebbe vedere la sezione.
  const gestionEnabled = workspace === 'shop' && GESTION_VIEW_PERMISSIONS.some((permission) => canAdmin(access, permission))
    ? await isBusinessManagementEnabled(tenant.id)
    : false;
  // WhatsApp (flag whatsapp_business): letto solo se l'admin potrebbe vedere la sezione.
  const whatsappEnabled = workspace === 'shop' && canAdmin(access, 'whatsapp.view') ? await isWhatsAppEnabled(tenant.id) : false;
  const pendingPaymentsCount = pendingPaymentsResult.count ?? 0;
  const pendingEventRequestsCount = pendingEventRequestsResult.count ?? 0;
  const pendingRentalRequestsCount = pendingRentalRequestsResult.count ?? 0;
  const newInquiriesCount = newInquiriesResult.count ?? 0;
  const displayName = access.nickname || [access.firstName, access.lastName].filter(Boolean).join(' ') || user.email || '';

  return (
    <AdminThemeProvider>
      <AdminHeader platformName={platform.platformName} platformLogoUrl={platform.logoUrl} tenantName={tenant.name} tenantLogoUrl={tenant.logo_url} categories={categories ?? []} workspace={workspace} shopAdminUrl={workspaceUrls.shopAdminUrl} eventsAdminUrl={workspaceUrls.eventsAdminUrl} isPlatformOwner={access.isPlatformOwner} permissions={navPermissions} adminEmail={user.email ?? ''} adminDisplayName={displayName} pendingPaymentsCount={pendingPaymentsCount} pendingEventRequestsCount={pendingEventRequestsCount} pendingRentalRequestsCount={pendingRentalRequestsCount} newInquiriesCount={newInquiriesCount} gestionEnabled={gestionEnabled} whatsappEnabled={whatsappEnabled} />
      <div className="flex min-h-[calc(100vh-57px)] bg-[var(--admin-page-bg)] dark:bg-gray-950">
        <aside className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-64 shrink-0 self-start overflow-y-auto border-r border-[var(--admin-border)] bg-white px-2 py-3 dark:border-gray-800 dark:bg-gray-900 md:block"><Suspense fallback={<div className="h-full w-full" />}><AdminSidebar categories={categories ?? []} workspace={workspace} permissions={navPermissions} pendingPaymentsCount={pendingPaymentsCount} pendingEventRequestsCount={pendingEventRequestsCount} pendingRentalRequestsCount={pendingRentalRequestsCount} newInquiriesCount={newInquiriesCount} isPlatformOwner={access.isPlatformOwner} gestionEnabled={gestionEnabled} whatsappEnabled={whatsappEnabled} /></Suspense></aside>
        <main className="min-w-0 flex-1 p-3 sm:p-5 lg:p-6 xl:p-8"><SubscriptionBanner serviceState={serviceState} canViewBilling={canAdmin(access, 'billing.view')} />{children}</main>
      </div>
    </AdminThemeProvider>
  );
}
