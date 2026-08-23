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
}

export default function AdminHeader({
  platformName,
  platformLogoUrl,
  tenantName,
  tenantLogoUrl,
  categories,
  isPlatformOwner = false,
  adminEmail,
}: AdminHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[var(--admin-border)] bg-white px-3 py-3 dark:border-gray-800 dark:bg-gray-900 md:px-6">
      <Suspense fallback={<div className="h-9 w-9 md:hidden" />}>
        <AdminMobileNav categories={categories} isPlatformOwner={isPlatformOwner} />
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

      <div className="hidden h-7 w-px bg-gray-200 md:block dark:bg-gray-700" />

      <div className="flex min-w-0 items-center gap-2">
        {tenantLogoUrl && <Image src={tenantLogoUrl} alt={tenantName} width={28} height={28} className="h-7 w-7 rounded-full border border-gray-100 object-contain" />}
        <div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{tenantName}</p><p className="hidden text-[11px] text-green-600 sm:block">Boutique active</p></div>
      </div>

      <div className="flex min-w-0 flex-1 justify-end md:mx-4 md:max-w-lg md:justify-start">
        <AdminGlobalSearch />
      </div>

      <div className="ml-auto flex items-center gap-1">
        <NotificationBell />
        <ThemeToggleButton />
        <AdminUserMenu adminEmail={adminEmail} />
      </div>
    </header>
  );
}
