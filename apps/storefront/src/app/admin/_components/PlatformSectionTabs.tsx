'use client';

import { usePathname } from 'next/navigation';
import AdminTabs from './ui/Tabs';
import { isNavHrefActive, platformNavGroup } from './platformNavConfig';

/** In-page tabs of a platform section, generated from PLATFORM_NAV (same entries as the sidebar group). */
export default function PlatformSectionTabs({ groupId }: { groupId: string }) {
  const pathname = usePathname() ?? '';
  const items = platformNavGroup(groupId)?.children ?? [];
  if (items.length < 2) return null;
  return <AdminTabs label="Sections" className="mt-4" tabs={items.map((item) => ({ href: item.href, label: item.label, active: isNavHrefActive(pathname, item.href, item.match) }))} />;
}
