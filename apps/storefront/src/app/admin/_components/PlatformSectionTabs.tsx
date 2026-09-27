'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isNavHrefActive, platformNavGroup } from './platformNavConfig';

/** In-page tabs of a platform section, generated from PLATFORM_NAV (same entries as the sidebar group). */
export default function PlatformSectionTabs({ groupId }: { groupId: string }) {
  const pathname = usePathname();
  const items = platformNavGroup(groupId)?.children ?? [];
  if (items.length < 2) return null;
  return (
    <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800" aria-label="Sections">
      {items.map((item) => {
        const active = isNavHrefActive(pathname, item.href, item.match);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${active
              ? 'border-[var(--admin-primary)] text-[var(--admin-primary-fg)]'
              : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
