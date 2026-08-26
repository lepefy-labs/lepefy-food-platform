import { Suspense } from 'react';
import Image from 'next/image';
import { IconBuildingStore, IconCalendarEvent, IconChevronDown } from '@tabler/icons-react';
import type { AdminWorkspace } from '@/lib/admin/workspace';
import AdminMobileNav from './AdminMobileNav';
import AdminGlobalSearch from './AdminGlobalSearch';
import ThemeToggleButton from './ThemeToggleButton';
import NotificationBell from './ui/NotificationBell';
import AdminUserMenu from './AdminUserMenu';

interface AdminHeaderProps {
  platformName: string;
  platformLogoUrl: string | null;
  tenantName: string;
  tenantLogoUrl: string | null;
  categories: { id: string; name: string; slug: string }[];
  workspace: AdminWorkspace;
  shopAdminUrl: string;
  eventsAdminUrl: string | null;
  isPlatformOwner?: boolean;
  adminEmail: string;
  pendingPaymentsCount?: number;
  pendingEventRequestsCount?: number;
  pendingRentalRequestsCount?: number;
  newInquiriesCount?: number;
}

export default function AdminHeader({ platformName, platformLogoUrl, tenantName, tenantLogoUrl, categories, workspace, shopAdminUrl, eventsAdminUrl, isPlatformOwner = false, adminEmail, pendingPaymentsCount = 0, pendingEventRequestsCount = 0, pendingRentalRequestsCount = 0, newInquiriesCount = 0 }: AdminHeaderProps) {
  const workspaceLabel = workspace === 'events' ? 'Événementiel' : 'Boutique';
  return (
    <header className="sticky top-0 z-30 flex min-h-[57px] items-center gap-2 border-b border-[var(--admin-border)] bg-white/95 px-3 py-2.5 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 md:gap-3 md:px-6">
      <Suspense fallback={<div className="h-9 w-9 md:hidden" />}><AdminMobileNav categories={categories} workspace={workspace} isPlatformOwner={isPlatformOwner} pendingPaymentsCount={pendingPaymentsCount} pendingEventRequestsCount={pendingEventRequestsCount} pendingRentalRequestsCount={pendingRentalRequestsCount} newInquiriesCount={newInquiriesCount} /></Suspense>
      <div className="hidden items-center gap-2 md:flex">{platformLogoUrl ? <Image src={platformLogoUrl} alt={platformName} width={112} height={30} className="h-7 w-auto object-contain" priority /> : <div className="flex items-center gap-2 text-[var(--admin-primary-fg)]"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--admin-primary)] text-sm font-bold text-white">L</span><span className="text-base font-semibold">{platformName}</span></div>}</div>
      <div className="hidden h-7 w-px bg-[var(--admin-border)] md:block" />
      <details className="group relative">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-xl border border-transparent px-2 py-1.5 hover:border-[var(--admin-border)] hover:bg-[var(--admin-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)]">
          {workspace === 'events' ? <IconCalendarEvent size={18} className="text-[var(--admin-primary)]" /> : <IconBuildingStore size={18} className="text-[var(--admin-primary)]" />}
          <div className="min-w-0 text-left"><p className="max-w-32 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{workspaceLabel}</p><p className="hidden max-w-36 truncate text-[10px] text-gray-400 sm:block">{tenantName}</p></div><IconChevronDown size={14} className="text-gray-400 transition group-open:rotate-180" />
        </summary>
        <div className="absolute left-0 z-50 mt-2 w-56 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-900">
          <a href={shopAdminUrl} className={`flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm ${workspace === 'shop' ? 'bg-[var(--admin-primary-soft)] font-semibold text-[var(--admin-primary-fg)]' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800'}`}><IconBuildingStore size={17} />Boutique</a>
          {eventsAdminUrl && <a href={eventsAdminUrl} className={`flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm ${workspace === 'events' ? 'bg-[var(--admin-primary-soft)] font-semibold text-[var(--admin-primary-fg)]' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800'}`}><IconCalendarEvent size={17} />Événementiel</a>}
        </div>
      </details>
      {tenantLogoUrl && <Image src={tenantLogoUrl} alt={tenantName} width={28} height={28} className="hidden h-7 w-7 rounded-full border border-gray-100 bg-white object-contain lg:block" />}
      <div className="flex min-w-0 flex-1 justify-end md:mx-4 md:max-w-lg md:justify-start"><AdminGlobalSearch /></div>
      <div className="ml-auto flex items-center gap-0.5 sm:gap-1"><NotificationBell /><ThemeToggleButton /><AdminUserMenu adminEmail={adminEmail} /></div>
    </header>
  );
}
