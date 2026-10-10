'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { ADMIN_NAV_GROUPS, isHrefActive, isNavItemActive, navItemsById, type AdminNavItem } from '@/lib/admin/navigation';
import { cn } from '@/lib/utils/cn';
import { CountBadge } from '../ui/Badge';
import { PLATFORM_NAV, isGroupActive } from '../platformNavConfig';
import type { AdminShellNav } from './shellState';

const PLATFORM_OPEN_KEY = 'lepefy-admin-platform-nav-open';

const itemClass = (active: boolean) => cn(
  'admin-nav-item relative flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-a-focus',
  active
    ? 'bg-a-selected font-semibold text-a-brand-fg before:absolute before:-left-2 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-a-brand'
    : 'text-a-text-2 hover:bg-a-hover hover:text-a-text',
);

function NavLink({ item, pathname, badge }: { item: AdminNavItem; pathname: string; badge: number }) {
  const active = isNavItemActive(pathname, item);
  const Icon = item.icon;
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined} title={item.label} className={itemClass(active)}>
      <Icon size={18} stroke={1.8} aria-hidden="true" className="shrink-0" />
      <span className="admin-nav-label min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge && badge > 0 && (
        <span className="admin-nav-count"><CountBadge tone={item.badge.tone} count={badge} label={`${badge} ${item.badge.label}`} /></span>
      )}
    </Link>
  );
}

function readOpenGroups(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(PLATFORM_OPEN_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Platform-owner block from PLATFORM_NAV; the group of the current page is always open. */
function PlatformSection({ pathname }: { pathname: string }) {
  const [opened, setOpened] = useState<string[]>([]);
  useEffect(() => { setOpened(readOpenGroups()); }, []);
  function toggle(id: string) {
    setOpened((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      try { window.localStorage.setItem(PLATFORM_OPEN_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience */ }
      return next;
    });
  }
  return (
    <div role="group" aria-labelledby="admin-nav-group-platform" className="space-y-0.5">
      <p id="admin-nav-group-platform" className="admin-nav-group px-2.5 pb-1 pt-4 text-xs font-semibold text-a-text-3">Plateforme</p>
      {PLATFORM_NAV.map((group) => {
        const Icon = group.icon;
        if (group.href) {
          const active = isHrefActive(pathname, group.href, group.match);
          return (
            <Link key={group.id} href={group.href} title={group.label} aria-current={active ? 'page' : undefined} className={itemClass(active)}>
              <Icon size={18} stroke={1.8} aria-hidden="true" className="shrink-0" />
              <span className="admin-nav-label min-w-0 flex-1 truncate">{group.label}</span>
            </Link>
          );
        }
        const active = isGroupActive(pathname, group);
        const open = active || opened.includes(group.id);
        const panelId = `platform-nav-${group.id}`;
        const first = group.children?.[0]?.href ?? '/admin/platform';
        return (
          <div key={group.id}>
            {/* Collapsed rail: the icon goes to the group's first page. */}
            <Link href={first} title={group.label} aria-hidden="true" tabIndex={-1} className={cn(itemClass(active), 'admin-nav-rail-only')}>
              <Icon size={18} stroke={1.8} className="shrink-0" />
            </Link>
            <button
              type="button"
              onClick={() => { if (!active) toggle(group.id); }}
              aria-expanded={open}
              aria-controls={panelId}
              className={cn(itemClass(false), 'admin-nav-full-only w-full text-left', active && 'font-semibold text-a-text')}
            >
              <Icon size={18} stroke={1.8} aria-hidden="true" className="shrink-0" />
              <span className="admin-nav-label flex-1 truncate">{group.label}</span>
              <IconChevronDown size={16} aria-hidden="true" className={cn('admin-nav-label transition-transform', open && 'rotate-180', active && 'opacity-40')} />
            </button>
            {open && (
              <div id={panelId} className="admin-nav-children mb-1 ml-5 mt-0.5 space-y-0.5 border-l border-a-border pl-2">
                {(group.children ?? []).map((item) => {
                  const childActive = isHrefActive(pathname, item.href, item.match);
                  return <Link key={item.href} href={item.href} aria-current={childActive ? 'page' : undefined} className={itemClass(childActive)}>{item.label}</Link>;
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Navigation list shared by the desktop rail and the mobile drawer. */
export default function AdminNav({ nav }: { nav: AdminShellNav }) {
  const pathname = usePathname() ?? '/admin';
  const items = navItemsById(nav.items);
  return (
    <nav aria-label="Navigation principale" className="space-y-0.5 pb-3 [&>div:first-child>.admin-nav-group]:pt-1">
      {ADMIN_NAV_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;
        const groupId = `admin-nav-group-${group.toLowerCase().replace(/[^a-z]+/g, '-')}`;
        return (
          <div key={group} role="group" aria-labelledby={groupId} className="space-y-0.5">
            <p id={groupId} className="admin-nav-group px-2.5 pb-1 pt-4 text-xs font-semibold text-a-text-3">{group}</p>
            <span aria-hidden="true" className="admin-nav-separator mx-2 my-2 hidden border-t border-a-border" />
            {groupItems.map((item) => <NavLink key={item.id} item={item} pathname={pathname} badge={item.badge ? nav.badges[item.badge.key] : 0} />)}
          </div>
        );
      })}
      {nav.platform && <PlatformSection pathname={pathname} />}
    </nav>
  );
}
