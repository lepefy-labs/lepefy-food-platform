import { existsSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { RELATED_DESTINATIONS, SETTINGS_GROUPS, SETTINGS_SECTIONS } from '../../src/app/admin/(protected)/parametres/_components/settingsRegistry';
import { permissionForAdminPath } from '../../src/lib/auth/adminRoutePermissions';

const ADMIN_DIR = path.join(__dirname, '../../src/app/admin/(protected)');

function pageFileFor(href: string): string {
  const route = href.split('#')[0]!.replace(/^\/admin\/?/, '');
  return path.join(ADMIN_DIR, route, 'page.tsx');
}

test('every Settings Hub destination has a page and stays under tenant_settings.view', () => {
  const hrefs = new Set<string>();
  for (const section of SETTINGS_SECTIONS) {
    expect(section.href.startsWith('/admin/parametres/')).toBe(true);
    expect(hrefs.has(section.href)).toBe(false);
    hrefs.add(section.href);
    expect(existsSync(pageFileFor(section.href)), section.href).toBe(true);
    expect(permissionForAdminPath(section.href, 'shop')).toBe('tenant_settings.view');
    for (const entry of section.entries) {
      expect(entry.href.split('#')[0]).toBe(section.href);
    }
  }
  expect(existsSync(pageFileFor('/admin/parametres'))).toBe(true);
});

test('the hub covers the approved groups in order', () => {
  expect(SETTINGS_GROUPS.map((group) => group.label)).toEqual(['Boutique', 'Communication', 'Commerce', 'Organisation']);
  expect(SETTINGS_SECTIONS.map((section) => section.key)).toEqual([
    'boutique', 'retrait', 'apparence', 'presence', 'notifications', 'automatisations', 'paiements', 'integrations', 'legal',
  ]);
});

test('content and tenant tools moved out of Paramètres keep the same access', () => {
  for (const item of RELATED_DESTINATIONS) {
    expect(existsSync(pageFileFor(item.href)), item.href).toBe(true);
    expect(permissionForAdminPath(item.href, 'shop')).toBe('tenant_settings.view');
  }
  // The event-workspace content module keeps its own permission.
  expect(permissionForAdminPath('/admin/evenementiel/contenu', 'events')).toBe('event_content.manage');
});
