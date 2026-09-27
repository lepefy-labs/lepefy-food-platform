import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from '@playwright/test';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { PLATFORM_NAV, platformNavGroup } from '../../src/app/admin/_components/platformNavConfig';

// Laboratoire and Diagnostic Packlink are platform-owner tools: their pages
// live under /admin/platform and their APIs use requirePlatformOwner().
const SRC = join(__dirname, '../../src');
const API = join(SRC, 'app/api/admin');
const TECH_API_DIRS = ['shipping-simulator', 'shipping-simulation-campaigns', 'shipping-postal-code-import', 'packlink-inspector', 'packlink-shipments'];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? routeFiles(path) : name === 'route.ts' ? [path] : [];
  });
}

test('every technical shipping API is guarded by requirePlatformOwner, never requireAdmin', () => {
  const files = TECH_API_DIRS.flatMap((dir) => routeFiles(join(API, dir)));
  expect(files.length).toBe(11);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const handlers = source.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
    const guards = source.match(/await requirePlatformOwner\(\)/g) ?? [];
    expect(handlers.length, relative(SRC, file)).toBeGreaterThan(0);
    expect(guards.length, relative(SRC, file)).toBe(handlers.length);
    expect(source, relative(SRC, file)).not.toContain('requireAdmin');
  }
});

test('technical shipping APIs are absent from the tenant capability map', () => {
  const paths = ['/api/admin/shipping-simulator', '/api/admin/shipping-simulation-campaigns', '/api/admin/shipping-simulation-campaigns/abc',
    '/api/admin/shipping-simulation-campaigns/abc/process', '/api/admin/shipping-simulation-campaigns/abc/cancel',
    '/api/admin/shipping-simulation-campaigns/abc/resample', '/api/admin/shipping-simulation-campaigns/zone-sentinels',
    '/api/admin/shipping-simulation-campaigns/city-postal-codes', '/api/admin/shipping-postal-code-import',
    '/api/admin/packlink-inspector', '/api/admin/packlink-shipments'];
  for (const path of paths) {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) expect(permissionForAdminApi(path, method), `${method} ${path}`).toBeNull();
  }
  // Tenant shipping pages keep their capabilities.
  expect(permissionForAdminApi('/api/admin/shipping-advisor', 'GET')).toBe('shipping.view');
  expect(permissionForAdminApi('/api/admin/shipping-tariff-drafts', 'POST')).toBe('shipping.manage');
  expect(permissionForAdminApi('/api/admin/shipping-packaging-profiles', 'GET')).toBe('shipping.view');
});

test('platform navigation exposes the technical shipping tools', () => {
  const group = platformNavGroup('shipping')!;
  expect(group.label).toBe('Livraison technique');
  expect(group.children!.map((item) => item.href)).toEqual([
    '/admin/platform/livraison/laboratoire',
    '/admin/platform/livraison/diagnostic-packlink',
  ]);
  expect(PLATFORM_NAV.findIndex((g) => g.id === 'shipping')).toBeLessThan(PLATFORM_NAV.findIndex((g) => g.id === 'development'));
});

test('tenant Livraison tabs no longer link to the moved tools and old URLs redirect', () => {
  const tabs = readFileSync(join(SRC, 'app/admin/(protected)/livraison/LivraisonTabs.tsx'), 'utf8');
  expect(tabs).not.toContain('laboratoire');
  expect(tabs).not.toContain('diagnostic-packlink');
  for (const [page, target] of [
    ['livraison/laboratoire/page.tsx', '/admin/platform/livraison/laboratoire'],
    ['livraison/laboratoire/[id]/page.tsx', '/admin/platform/livraison/laboratoire/'],
    ['livraison/diagnostic-packlink/page.tsx', '/admin/platform/livraison/diagnostic-packlink'],
    ['livraison/simulateur/page.tsx', '/admin/platform/livraison/laboratoire'],
  ] as const) {
    const source = readFileSync(join(SRC, 'app/admin/(protected)', page), 'utf8');
    expect(source, page).toContain('redirect(');
    expect(source, page).toContain(target);
  }
});
