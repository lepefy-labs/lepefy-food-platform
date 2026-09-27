import { expect, test } from '@playwright/test';
import { isGroupActive, isNavHrefActive, PLATFORM_NAV, platformNavGroup } from '../../src/app/admin/_components/platformNavConfig';

const allHrefs = PLATFORM_NAV.flatMap((group) => (group.href ? [group.href] : (group.children ?? []).map((item) => item.href)));

test('every platform page appears once and groups are either a link or a list', () => {
  expect(new Set(allHrefs).size).toBe(allHrefs.length);
  for (const group of PLATFORM_NAV) expect(Boolean(group.href) !== Boolean(group.children?.length)).toBe(true);
  // Former flat entries keep their URLs.
  for (const href of ['/admin/team', '/admin/platform/access', '/admin/platform/ai-routing', '/admin/platform/ai-usage',
    '/admin/platform/prospects', '/admin/platform/feedback']) expect(allHrefs).toContain(href);
});

test('active state: console is exact, groups follow their pages and sub-pages', () => {
  expect(isNavHrefActive('/admin/platform/prospects', '/admin/platform', 'exact')).toBe(false);
  expect(isNavHrefActive('/admin/platform/prospects/abc', '/admin/platform/prospects')).toBe(true);
  expect(isNavHrefActive('/admin/platform/prospectsx', '/admin/platform/prospects')).toBe(false);
  const notifications = platformNavGroup('notifications')!;
  expect(notifications.children!.map((item) => item.label)).toEqual(['Historique', 'Tests']);
  expect(isGroupActive('/admin/platform/notifications/tests', notifications)).toBe(true);
  expect(isGroupActive('/admin/team', platformNavGroup('access')!)).toBe(true);
  expect(isGroupActive('/admin/team', notifications)).toBe(false);
});
