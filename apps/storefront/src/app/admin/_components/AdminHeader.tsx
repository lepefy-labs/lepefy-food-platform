import Image from 'next/image';
import Link from 'next/link';
import type { AdminWorkspace } from '@/lib/admin/workspace';
import ThemeToggleButton from './ThemeToggleButton';
import NotificationBell from './ui/NotificationBell';
import { NavMenuButton, PaletteTrigger, UserMenu, WorkspaceMenu } from './shell/HeaderControls';

interface AdminHeaderProps {
  platformName: string;
  platformLogoUrl: string | null;
  tenantName: string;
  tenantLogoUrl: string | null;
  workspace: AdminWorkspace;
  shopAdminUrl: string;
  eventsAdminUrl: string | null;
  canShop: boolean;
  canEvents: boolean;
  adminEmail: string;
  adminDisplayName?: string;
}

/** Admin top bar: menu (mobile), platform logo, workspace, command palette, notifications, theme, account. */
export default function AdminHeader({ platformName, platformLogoUrl, tenantName, tenantLogoUrl, workspace, shopAdminUrl, eventsAdminUrl, canShop, canEvents, adminEmail, adminDisplayName }: AdminHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-a-border bg-a-surface px-3 md:gap-3 md:px-4">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-a-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-a-text focus:shadow">
        Aller au contenu
      </a>
      <NavMenuButton />
      <Link href="/admin" className="hidden w-[13.5rem] shrink-0 items-center gap-2 md:flex" aria-label={`${platformName} — accueil de l’administration`}>
        {platformLogoUrl
          ? <Image src={platformLogoUrl} alt="" width={112} height={30} className="h-7 w-auto object-contain" priority />
          : <><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-a-brand text-sm font-bold text-a-on-brand">L</span><span className="text-base font-semibold text-a-text">{platformName}</span></>}
      </Link>
      <WorkspaceMenu workspace={workspace} tenantName={tenantName} tenantLogoUrl={tenantLogoUrl} shopAdminUrl={shopAdminUrl} eventsAdminUrl={eventsAdminUrl} canShop={canShop} canEvents={canEvents} />
      <div className="ml-auto flex min-w-0 items-center justify-end gap-1 md:ml-4 md:flex-1 md:justify-start">
        <PaletteTrigger />
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <NotificationBell />
        <ThemeToggleButton />
        <UserMenu adminEmail={adminEmail} adminDisplayName={adminDisplayName} />
      </div>
    </header>
  );
}
