'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconDots, IconLayoutSidebarLeftCollapse } from '@tabler/icons-react';
import { isNavItemActive, mobileNavItems } from '@/lib/admin/navigation';
import { cn } from '@/lib/utils/cn';
import { CountBadge } from '../ui/Badge';
import Dialog from '../ui/Dialog';
import AdminNav from './AdminNav';
import CommandPalette from './CommandPalette';
import { SIDEBAR_NO_FLASH_SCRIPT, SIDEBAR_STORAGE_KEY, type AdminShellNav } from './shellState';

interface ShellApi { openNav: () => void; openPalette: () => void }
const ShellContext = createContext<ShellApi>({ openNav: () => {}, openPalette: () => {} });
export const useAdminShell = () => useContext(ShellContext);

function isEditable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)));
}

function toggleCollapsed() {
  const root = document.documentElement;
  const collapsed = root.getAttribute('data-admin-sidebar') !== 'collapsed';
  if (collapsed) root.setAttribute('data-admin-sidebar', 'collapsed'); else root.removeAttribute('data-admin-sidebar');
  try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded'); } catch { /* per-viewer convenience */ }
}

function BottomNav({ nav, onMore }: { nav: AdminShellNav; onMore: () => void }) {
  const pathname = usePathname() ?? '/admin';
  const items = mobileNavItems(nav.items);
  if (items.length === 0) return null;
  return (
    <nav aria-label="Navigation rapide" className="fixed inset-x-0 bottom-0 z-30 grid border-t border-a-border bg-a-surface pb-[env(safe-area-inset-bottom)] md:hidden" style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}>
      {items.map((item) => {
        const active = isNavItemActive(pathname, item);
        const Icon = item.icon;
        const badge = item.badge ? nav.badges[item.badge.key] : 0;
        return (
          <Link key={item.id} href={item.href} aria-current={active ? 'page' : undefined}
            className={cn('relative flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-xs', active ? 'font-semibold text-a-brand-fg' : 'text-a-text-2')}>
            <span className="relative">
              <Icon size={22} stroke={1.8} aria-hidden="true" />
              {item.badge && badge > 0 && <span className="absolute -right-3 -top-1.5"><CountBadge tone={item.badge.tone} count={badge} label={`${badge} ${item.badge.label}`} /></span>}
            </span>
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        );
      })}
      <button type="button" onClick={onMore} className="flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs text-a-text-2">
        <IconDots size={22} stroke={1.8} aria-hidden="true" />Plus
      </button>
    </nav>
  );
}

/**
 * Client frame of the protected admin: desktop rail (collapsible, state on
 * <html> before paint), mobile drawer and bottom bar, command palette with
 * Ctrl/⌘ K and « / ». The header is passed in as a server-rendered slot.
 */
export default function AdminShell({ nav, workspaceLabel, tenantName, header, children }: {
  nav: AdminShellNav;
  workspaceLabel: string;
  tenantName: string;
  header: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openNav = useCallback(() => setNavOpen(true), []);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const api = useMemo(() => ({ openNav, openPalette }), [openNav, openPalette]);

  useEffect(() => { setNavOpen(false); }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen((value) => !value); return; }
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditable(event.target)) { event.preventDefault(); setPaletteOpen(true); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <ShellContext.Provider value={api}>
      <script dangerouslySetInnerHTML={{ __html: SIDEBAR_NO_FLASH_SCRIPT }} />
      {header}
      <div className="flex min-h-[calc(100dvh-3.5rem)]">
        <aside className="admin-sidebar sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 flex-col border-r border-a-border bg-a-surface md:flex">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3 [scrollbar-width:thin]">
            <AdminNav nav={nav} />
          </div>
          <div className="border-t border-a-border p-2">
            <button type="button" onClick={toggleCollapsed} title="Réduire ou agrandir le menu"
              className="admin-nav-item flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-a-text-2 hover:bg-a-hover hover:text-a-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
              <IconLayoutSidebarLeftCollapse size={18} stroke={1.8} aria-hidden="true" className="admin-collapse-icon shrink-0 transition-transform" />
              <span className="admin-nav-label">Réduire le menu</span>
            </button>
          </div>
        </aside>
        <main id="admin-main" className="min-w-0 flex-1 px-3 pb-24 pt-4 sm:px-5 md:pb-10 lg:px-6 xl:px-8">{children}</main>
      </div>
      <BottomNav nav={nav} onMore={openNav} />
      <Dialog open={navOpen} onClose={() => setNavOpen(false)} placement="left" title={workspaceLabel} description={tenantName} bodyClassName="px-2 py-2">
        <AdminNav nav={nav} />
      </Dialog>
      <CommandPalette nav={nav} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </ShellContext.Provider>
  );
}
