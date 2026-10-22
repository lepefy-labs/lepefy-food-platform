'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { ADMIN_NAV_GROUPS, activeNavChild, isHrefActive, visibleNavChildren, isNavItemActive, isPrimaryNavGroup, navItemsById, type AdminNavGroup, type AdminNavItem } from '@/lib/admin/navigation';
import { cn } from '@/lib/utils/cn';
import { CountBadge } from '../ui/Badge';
import { PLATFORM_NAV, isGroupActive } from '../platformNavConfig';
import type { AdminShellNav } from './shellState';

const PLATFORM_OPEN_KEY = 'lepefy-admin-platform-nav-open';
const GROUPS_OPEN_KEY = 'lepefy-admin-nav-groups-open';

const itemClass = (active: boolean) => cn(
  'admin-nav-item relative flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-a-focus',
  active
    ? 'bg-a-selected font-semibold text-a-brand-fg before:absolute before:-left-2 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r before:bg-a-brand'
    : 'text-a-text-2 hover:bg-a-hover hover:text-a-text',
);

function NavLink({ item, pathname, nav }: { item: AdminNavItem; pathname: string; nav: AdminShellNav }) {
  const badge = item.badge ? nav.badges[item.badge.key] : 0;
  const active = isNavItemActive(pathname, item);
  const Icon = item.icon;
  const link = (
    <Link href={item.href} aria-current={active && visibleNavChildren(item, nav.children).length < 2 ? 'page' : undefined} title={item.label} className={itemClass(active)}>
      <Icon size={18} stroke={1.8} aria-hidden="true" className="shrink-0" />
      <span className="admin-nav-label min-w-0 flex-1 truncate">{item.label}</span>
      {item.badge && badge > 0 && (
        <span className="admin-nav-count"><CountBadge tone={item.badge.tone} count={badge} label={`${badge} ${item.badge.label}`} /></span>
      )}
    </Link>
  );
  const children = visibleNavChildren(item, nav.children);
  if (children.length < 2 || !active) return link;
  // Sub-pages of the active module; hidden in the collapsed rail (admin-nav-children).
  const current = activeNavChild(pathname, children);
  return (
    <div>
      {link}
      <div className="admin-nav-children mb-1 ml-5 mt-0.5 space-y-0.5 border-l border-a-border pl-2">
        {children.map((child) => {
          const childActive = child === current;
          const childBadge = child.badge ? nav.badges[child.badge.key] : 0;
          return (
            <Link key={child.href} href={child.href} aria-current={childActive ? 'page' : undefined} className={itemClass(childActive)}>
              <span className="min-w-0 flex-1">{child.label}</span>
              {child.badge && childBadge > 0 && <CountBadge tone={child.badge.tone} count={childBadge} label={`${childBadge} ${child.badge.label}`} />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function readOpenGroups(key = PLATFORM_OPEN_KEY): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Platform-owner block from PLATFORM_NAV; the group of the current page is always open. */
function PlatformSection({ pathname, badges }: { pathname: string; badges: AdminShellNav['badges'] }) {
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
              {group.badge && (badges[group.badge.key] ?? 0) > 0 && (
                <span className="admin-nav-count"><CountBadge tone="warning" count={badges[group.badge.key]} label={`${badges[group.badge.key]} ${group.badge.label}`} /></span>
              )}
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

/**
 * Folding group (every group but the daily ones): open on its active entry,
 * otherwise as the viewer left it. In the collapsed rail every icon stays
 * visible (admin-nav-folded).
 */
function FoldingGroup({ group, groupId, items, pathname, nav, opened, onToggle }: {
  group: AdminNavGroup; groupId: string; items: AdminNavItem[]; pathname: string; nav: AdminShellNav; opened: boolean; onToggle: () => void;
}) {
  const active = items.some((item) => isNavItemActive(pathname, item));
  const open = active || opened;
  const panelId = `${groupId}-items`;
  return (
    <div role="group" aria-labelledby={groupId} className="space-y-0.5">
      <button
        id={groupId}
        type="button"
        onClick={() => { if (!active) onToggle(); }}
        aria-expanded={open}
        aria-controls={panelId}
        className="admin-nav-group admin-nav-full-only flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 pb-1 pt-3 text-left text-xs font-semibold text-a-text-3 hover:text-a-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus"
      >
        <span>{group}</span>
        <IconChevronDown size={14} aria-hidden="true" className={cn('transition-transform', open && 'rotate-180', active && 'opacity-40')} />
      </button>
      <span aria-hidden="true" className="admin-nav-separator mx-2 my-2 hidden border-t border-a-border" />
      <div id={panelId} className={cn('admin-nav-folded space-y-0.5', !open && 'hidden')}>
        {items.map((item) => <NavLink key={item.id} item={item} pathname={pathname} nav={nav} />)}
      </div>
    </div>
  );
}

/** Navigation list shared by the desktop rail and the mobile drawer. */
export default function AdminNav({ nav }: { nav: AdminShellNav }) {
  const pathname = usePathname() ?? '/admin';
  const items = navItemsById(nav.items);
  const [opened, setOpened] = useState<string[]>([]);
  useEffect(() => { setOpened(readOpenGroups(GROUPS_OPEN_KEY)); }, []);
  function toggle(group: string) {
    setOpened((current) => {
      const next = current.includes(group) ? current.filter((item) => item !== group) : [...current, group];
      try { window.localStorage.setItem(GROUPS_OPEN_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience */ }
      return next;
    });
  }
  return (
    <nav aria-label="Navigation principale" className="space-y-0.5 pb-3 [&>div:first-child>.admin-nav-group]:pt-1">
      {ADMIN_NAV_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;
        const groupId = `admin-nav-group-${group.toLowerCase().normalize('NFD').replace(/[^a-z]+/g, '-')}`;
        if (!isPrimaryNavGroup(group)) {
          return <FoldingGroup key={group} group={group} groupId={groupId} items={groupItems} pathname={pathname} nav={nav} opened={opened.includes(group)} onToggle={() => toggle(group)} />;
        }
        return (
          <div key={group} role="group" aria-labelledby={groupId} className="space-y-0.5">
            {/* « Essentiel » is the shop's daily work: named for assistive tech only. */}
            <p id={groupId} className={cn('admin-nav-group px-2.5 pb-1 pt-4 text-xs font-semibold text-a-text-3', group === 'Essentiel' && 'sr-only')}>{group}</p>
            <span aria-hidden="true" className="admin-nav-separator mx-2 my-2 hidden border-t border-a-border" />
            {groupItems.map((item) => <NavLink key={item.id} item={item} pathname={pathname} nav={nav} />)}
          </div>
        );
      })}
      {nav.platform && <PlatformSection pathname={pathname} badges={nav.badges} />}
    </nav>
  );
}
