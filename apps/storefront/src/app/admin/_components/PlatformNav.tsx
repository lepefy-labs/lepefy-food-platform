'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { isGroupActive, isNavHrefActive, PLATFORM_NAV } from './platformNavConfig';

const STORAGE_KEY = 'lepefy-admin-platform-nav-open';

function readStoredOpen(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Platform-owner sidebar block built from PLATFORM_NAV: single links and
 * expandable groups. The group holding the current page is always open;
 * other groups remember whether the user opened them (localStorage).
 */
export default function PlatformNav({ pathname, linkClass, groupLabel }: {
  pathname: string;
  linkClass: (active: boolean) => string;
  groupLabel: string;
}) {
  const [opened, setOpened] = useState<string[]>([]);
  useEffect(() => { setOpened(readStoredOpen()); }, []);

  function toggle(id: string) {
    setOpened((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
      return next;
    });
  }

  return <>
    <p className={groupLabel}>Plateforme</p>
    {PLATFORM_NAV.map((group) => {
      const Icon = group.icon;
      if (group.href) {
        return <Link key={group.id} href={group.href} className={linkClass(isNavHrefActive(pathname, group.href, group.match))}><Icon size={20} />{group.label}</Link>;
      }
      const active = isGroupActive(pathname, group);
      const open = active || opened.includes(group.id);
      const panelId = `platform-nav-${group.id}`;
      return <div key={group.id}>
        <button
          type="button"
          onClick={() => { if (!active) toggle(group.id); }}
          aria-expanded={open}
          aria-controls={panelId}
          className={`${linkClass(false)} w-[calc(100%-0.5rem)] text-left ${active ? 'font-semibold text-gray-900 dark:text-white' : ''}`}
        >
          <Icon size={20} />
          <span className="flex-1">{group.label}</span>
          <IconChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''} ${active ? 'opacity-40' : ''}`} />
        </button>
        {open && (
          <div id={panelId} className="mb-1 ml-6 mt-0.5 space-y-0.5 border-l border-gray-200 pl-2 dark:border-gray-700">
            {(group.children ?? []).map((item) => (
              <Link key={item.href} href={item.href} className={`${linkClass(isNavHrefActive(pathname, item.href, item.match))} min-h-9 py-1.5`}>
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </div>;
    })}
  </>;
}
