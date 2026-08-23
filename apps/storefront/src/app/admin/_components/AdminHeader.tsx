import { Suspense } from 'react';
import Image from 'next/image';
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
  isPlatformOwner?: boolean;
  adminEmail: string;
  pendingPaymentsCount?: number;
  pendingEventRequestsCount?: number;
  pendingRentalRequestsCount?: number;
  newInquiriesCount?: number;
}

export default function AdminHeader({
  platformName,
  platformLogoUrl,
  tenantName,
  tenantLogoUrl,
  categories,
  isPlatformOwner = false,
  adminEmail,
  pendingPaymentsCount = 0,
  pendingEventRequestsCount = 0,
  pendingRentalRequestsCount = 0,
  newInquiriesCount = 0,
}: AdminHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex min-h-[57px] items-center gap-2 border-b border-[var(--admin-border)] bg-white/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-white/90 dark:border-gray-800 dark:bg-gray-900/95 md:gap-3 md:px-6">
      <Suspense fallback={<div className="h-9 w-9 md:hidden" />}>
        <AdminMobileNav
          categories={categories}
          isPlatformOwner={isPlatformOwner}
          pendingPaymentsCount={pendingPaymentsCount}
          pendingEventRequestsCount={pendingEventRequestsCount}
          pendingRentalRequestsCount={pendingRentalRequestsCount}
          newInquiriesCount={newInquiriesCount}
        />
      </Suspense>

      <div className="hidden items-center gap-2 md:flex">
        {platformLogoUrl ? (
          <Image src={platformLogoUrl} alt={platformName} width={112} height={30} className="h-7 w-auto object-contain" priority />
        ) : (
          <div className="flex items-center gap-2 text-[var(--admin-primary-fg)]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--admin-primary)] text-sm font-bold text-white">L</span>
            <span className="text-base font-semibold">{platformName}</span>
          </div>
        )}
      </div>

      <div className="hidden h-7 w-px bg-[var(--admin-border)] md:block dark:bg-gray-700" />

      <div className="flex min-w-0 items-center gap-2 rounded-xl px-1.5 py-1 md:px-2">
        {tenantLogoUrl && <Image src={tenantLogoUrl} alt={tenantName} width={28} height={28} className="h-7 w-7 rounded-full border border-gray-100 bg-white object-contain" />}
        <div className="min-w-0">
          <p className="max-w-28 truncate text-sm font-semibold text-gray-900 dark:text-gray-100 sm:max-w-44">{tenantName}</p>
          <p className="hidden items-center gap-1.5 text-[11px] text-emerald-600 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Boutique active</p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 justify-end md:mx-4 md:max-w-lg md:justify-start">
        <AdminGlobalSearch />
      </div>

      <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
        <NotificationBell />
        <ThemeToggleButton />
        <AdminUserMenu adminEmail={adminEmail} />
      </div>
    </header>
  );
}
