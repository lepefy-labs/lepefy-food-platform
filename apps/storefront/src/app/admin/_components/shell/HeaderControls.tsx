'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';
import { IconBuildingStore, IconCalendarEvent, IconCheck, IconChevronDown, IconLock, IconLogout, IconMenu2, IconSearch, IconUser } from '@tabler/icons-react';
import type { AdminWorkspace } from '@/lib/admin/workspace';
import { IconButton } from '../ui/Button';
import Menu, { MenuButton, MenuLink } from '../ui/Menu';
import { useAdminShell } from './AdminShell';

export function NavMenuButton() {
  const { openNav } = useAdminShell();
  return <IconButton label="Ouvrir le menu" icon={<IconMenu2 size={20} aria-hidden="true" />} onClick={openNav} className="-ml-1 md:hidden" />;
}

export function PaletteTrigger() {
  const { openPalette } = useAdminShell();
  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        aria-keyshortcuts="Control+K Meta+K /"
        className="hidden h-9 w-full max-w-md items-center gap-2 rounded-lg border border-a-border bg-a-surface-2 px-3 text-sm text-a-text-3 hover:border-a-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus md:flex"
      >
        <IconSearch size={16} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">Rechercher une commande, un client, une page…</span>
        <kbd className="rounded border border-a-border-strong bg-a-surface px-1.5 font-mono text-xs text-a-text-2">Ctrl K</kbd>
      </button>
      <IconButton label="Rechercher" icon={<IconSearch size={20} aria-hidden="true" />} onClick={openPalette} className="md:hidden" />
    </>
  );
}

function tenantInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'T';
}

export function WorkspaceMenu({ workspace, tenantName, tenantLogoUrl, shopAdminUrl, eventsAdminUrl, canShop, canEvents }: {
  workspace: AdminWorkspace;
  tenantName: string;
  tenantLogoUrl: string | null;
  shopAdminUrl: string;
  eventsAdminUrl: string | null;
  canShop: boolean;
  canEvents: boolean;
}) {
  const WorkspaceIcon = workspace === 'events' ? IconCalendarEvent : IconBuildingStore;
  const label = workspace === 'events' ? 'Événementiel' : 'Boutique';
  const logo = (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-a-border bg-white">
      {tenantLogoUrl
        ? <Image src={tenantLogoUrl} alt="" width={64} height={64} className="max-h-full max-w-full object-contain p-0.5" unoptimized />
        : <span className="text-xs font-bold text-a-text-2">{tenantInitials(tenantName)}</span>}
    </span>
  );
  const switchable = canShop && canEvents && Boolean(eventsAdminUrl);
  const summary = (
    <span className="flex min-w-0 items-center gap-2">
      {logo}
      <span className="hidden min-w-0 text-left sm:block">
        <span className="flex items-center gap-1 text-sm font-semibold text-a-text"><WorkspaceIcon size={15} aria-hidden="true" className="shrink-0 text-a-brand-fg" />{label}</span>
        <span className="block max-w-[10rem] truncate text-xs text-a-text-2">{tenantName}</span>
      </span>
    </span>
  );
  if (!switchable) return <div className="flex min-w-0 items-center px-1" aria-label={`${label} · ${tenantName}`}>{summary}</div>;
  return (
    <Menu
      align="start"
      label={`Espace ${label} · ${tenantName}. Changer d’espace`}
      triggerClassName="min-h-10 gap-1.5 px-1.5 py-1 hover:bg-a-hover"
      trigger={<>{summary}<IconChevronDown size={15} aria-hidden="true" className="text-a-text-2" /></>}
    >
      <MenuLink href={shopAdminUrl} external active={workspace === 'shop'}>
        <IconBuildingStore size={16} aria-hidden="true" /><span className="flex-1">Boutique</span>{workspace === 'shop' && <IconCheck size={16} aria-hidden="true" />}
      </MenuLink>
      <MenuLink href={eventsAdminUrl ?? '#'} external active={workspace === 'events'}>
        <IconCalendarEvent size={16} aria-hidden="true" /><span className="flex-1">Événementiel</span>{workspace === 'events' && <IconCheck size={16} aria-hidden="true" />}
      </MenuLink>
    </Menu>
  );
}

export function UserMenu({ adminEmail, adminDisplayName }: { adminEmail: string; adminDisplayName?: string }) {
  const router = useRouter();
  const label = adminDisplayName?.trim() || adminEmail;
  const initial = label.charAt(0).toUpperCase() || '?';

  async function logout() {
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    await supabase.auth.signOut();
    router.push('/admin/login');
    router.refresh();
  }

  return (
    <Menu
      label="Menu du compte"
      triggerClassName="gap-1 p-1 hover:bg-a-hover"
      trigger={<>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-a-brand-soft text-sm font-semibold text-a-brand-fg">{initial}</span>
        <IconChevronDown size={15} aria-hidden="true" className="hidden text-a-text-2 sm:block" />
      </>}
      header={<>
        <p className="truncate text-sm font-semibold text-a-text">{label}</p>
        <p className="mt-0.5 truncate text-xs text-a-text-2">{adminEmail}</p>
      </>}
    >
      <MenuLink href="/admin/onboarding?edit=1"><IconUser size={16} aria-hidden="true" />Mon profil</MenuLink>
      <MenuLink href="/admin/securite"><IconLock size={16} aria-hidden="true" />Sécurité</MenuLink>
      <MenuButton onSelect={() => void logout()}><IconLogout size={16} aria-hidden="true" />Se déconnecter</MenuButton>
    </Menu>
  );
}
