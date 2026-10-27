import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildAdminManifest, ADMIN_MANIFEST_PATH } from '../../src/lib/admin/adminManifest';
import { legacyAdminRedirect, pwaLaunchRedirect } from '../../src/lib/admin/adminHost';
import { getAdminWorkspaceUrls, isEventsAdminPath, resolveAdminWorkspace } from '../../src/lib/admin/workspace';
import { defaultAdminDestination, permissionsForAdminPath } from '../../src/lib/auth/adminRoutePermissions';
import { adminHostRedirects } from '../../adminHostRedirects.mjs';

const ROOT = join(__dirname, '../..');
const tenant = { storefront_url: 'https://chloefood.com/' };

type Redirect = { source: string; destination: string; permanent: boolean };

function withEnv(env: Record<string, string | undefined>, run: () => void) {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
  }
  try { run(); } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
}

test('the workspace follows the path; the legacy events host still maps to Événementiel', () => {
  withEnv({ NEXT_PUBLIC_EVENTS_SUBDOMAIN: 'evenements.chloefood.com' }, () => {
    expect(resolveAdminWorkspace('admin.chloefood.com', '/admin')).toBe('shop');
    expect(resolveAdminWorkspace('admin.chloefood.com', '/admin/evenementiel')).toBe('events');
    expect(resolveAdminWorkspace('admin.chloefood.com', '/admin/evenementiel/reservations')).toBe('events');
    expect(resolveAdminWorkspace('admin.chloefood.com', '/admin/evenementiel-x')).toBe('shop');
    expect(resolveAdminWorkspace('evenements.chloefood.com:443', '/admin')).toBe('events');
    expect(resolveAdminWorkspace('chloefood.com', '/admin/orders')).toBe('shop');
  });
  expect(isEventsAdminPath('/admin/evenementiel/scan')).toBe(true);
});

test('workspace URLs: relative on the unified admin origin, legacy absolute otherwise', () => {
  withEnv({ ADMIN_HOST: 'admin.chloefood.com', NEXT_PUBLIC_EVENTS_SUBDOMAIN: 'evenements.chloefood.com' }, () => {
    expect(getAdminWorkspaceUrls(tenant)).toMatchObject({ shopAdminUrl: '/admin', eventsAdminUrl: '/admin/evenementiel', adminBaseUrl: 'https://admin.chloefood.com' });
  });
  withEnv({ ADMIN_HOST: undefined, NEXT_PUBLIC_EVENTS_SUBDOMAIN: 'evenements.chloefood.com' }, () => {
    expect(getAdminWorkspaceUrls(tenant)).toMatchObject({ shopAdminUrl: 'https://chloefood.com/admin', eventsAdminUrl: 'https://evenements.chloefood.com/admin', adminBaseUrl: 'https://chloefood.com' });
  });
  withEnv({ ADMIN_HOST: undefined, NEXT_PUBLIC_EVENTS_SUBDOMAIN: undefined }, () => {
    expect(getAdminWorkspaceUrls(tenant).eventsAdminUrl).toBe('/admin/evenementiel');
  });
});

test('single-workspace collaborators land in the workspace they have', () => {
  expect(defaultAdminDestination(['events.view'], 'shop')).toBe('/admin/evenementiel');
  expect(defaultAdminDestination(['orders.view'], 'events')).toBe('/admin');
  expect(defaultAdminDestination(['orders.view'], 'events', { onLegacyEventsHost: true })).toBeNull();
  expect(defaultAdminDestination(['orders.view'], 'shop')).toBe('/admin');
  expect(defaultAdminDestination(['scan.access'], 'shop')).toBe('/admin/evenementiel/scan');
  expect(defaultAdminDestination([], 'shop')).toBeNull();
  expect(permissionsForAdminPath('/admin/evenementiel/scan', 'events')).toEqual(['scan.access']);
  // Platform pages stay behind platform.access whatever the host or workspace.
  expect(permissionsForAdminPath('/admin/platform/livraison', 'shop')).toEqual(['platform.access']);
});

test('Lepefy Admin manifest is its own app inside the admin scope', () => {
  const manifest = buildAdminManifest();
  expect(manifest.name).toBe('Lepefy Admin');
  expect(manifest.id).not.toBe('/');
  expect(manifest.display).toBe('standalone');
  const startPath = new URL(manifest.start_url ?? '', 'https://x.test').pathname;
  expect(startPath === manifest.scope || startPath.startsWith(`${manifest.scope}/`)).toBe(true);
  expect(manifest.scope).toBe('/admin');
  for (const icon of manifest.icons ?? []) expect(existsSync(join(ROOT, 'public', icon.src)), icon.src).toBe(true);
  expect((manifest.icons ?? []).some((icon) => icon.purpose === 'maskable')).toBe(true);
  expect(ADMIN_MANIFEST_PATH).toBe('/admin/manifest.webmanifest');
});

test('storefront PWA and service worker are untouched', () => {
  const sw = readFileSync(join(ROOT, 'public/sw.js'), 'utf8');
  expect(sw).not.toMatch(/addEventListener\('fetch'/);
  expect(readFileSync(join(ROOT, 'src/app/manifest.webmanifest/route.ts'), 'utf8')).toContain("start_url: '/'");
  // The admin layout overrides the manifest and icons the root layout declares as metadata.
  expect(readFileSync(join(ROOT, 'src/app/layout.tsx'), 'utf8')).not.toContain('rel="apple-touch-icon"');
  expect(readFileSync(join(ROOT, 'src/app/admin/layout.tsx'), 'utf8')).toContain('manifest: ADMIN_MANIFEST_PATH');
});

test('installed app launch reopens the last workspace, as a destination only', () => {
  expect(pwaLaunchRedirect({ pathname: '/admin', source: 'pwa', workspaceCookie: 'events' })).toBe('/admin/evenementiel');
  expect(pwaLaunchRedirect({ pathname: '/admin', source: 'pwa', workspaceCookie: 'shop' })).toBeNull();
  expect(pwaLaunchRedirect({ pathname: '/admin', source: null, workspaceCookie: 'events' })).toBeNull();
  expect(pwaLaunchRedirect({ pathname: '/admin/orders', source: 'pwa', workspaceCookie: 'events' })).toBeNull();
  expect(pwaLaunchRedirect({ pathname: '/admin', source: 'pwa', workspaceCookie: 'platform' })).toBeNull();
});

test('legacy /admin redirect is opt-in, only on the storefront host, and spares the invite page', () => {
  const base = { enabled: true, canonicalHost: 'admin.chloefood.com', storefrontHost: 'chloefood.com', host: 'chloefood.com', pathname: '/admin/orders', search: '?status=paid' };
  expect(legacyAdminRedirect(base)).toBe('https://admin.chloefood.com/admin/orders?status=paid');
  expect(legacyAdminRedirect({ ...base, enabled: false })).toBeNull();
  expect(legacyAdminRedirect({ ...base, host: 'admin.chloefood.com' })).toBeNull();
  expect(legacyAdminRedirect({ ...base, host: 'preview-x.vercel.app' })).toBeNull();
  expect(legacyAdminRedirect({ ...base, pathname: '/admin/accept-invite' })).toBeNull();
  expect(legacyAdminRedirect({ ...base, pathname: '/administration' })).toBeNull();
  expect(legacyAdminRedirect({ ...base, canonicalHost: '' })).toBeNull();
});

test('host redirects: none without ADMIN_HOST; fallback is temporary; storefront paths lead to the admin', () => {
  expect(adminHostRedirects({})).toEqual([]);
  const redirects: Redirect[] = adminHostRedirects({ ADMIN_HOST: 'admin.chloefood.com', ADMIN_FALLBACK_HOST: 'chloefood.admin.lepefy.com' });
  expect(redirects.every((redirect) => redirect.permanent === false)).toBe(true);
  expect(redirects[0]).toMatchObject({ source: '/:path*', destination: 'https://admin.chloefood.com/:path*' });
  const { match } = createRequire(__filename)('next/dist/compiled/path-to-regexp') as { match: (source: string) => (path: string) => unknown };
  const pageRule = redirects.find((redirect) => redirect.source !== '/' && redirect.source !== '/:path*');
  const matches = match(pageRule!.source);
  for (const path of ['/products/riz', '/cart', '/o/abc', '/evenementiel/evenements/x']) expect(matches(path), path).toBeTruthy();
  for (const path of ['/admin', '/admin/orders', '/admin/evenementiel/scan', '/api/admin/x', '/api/pwa-icon', '/_next/static/a.js', '/sw.js', '/brand/admin-192.png', '/favicon.ico']) expect(matches(path), path).toBeFalsy();
  // Same host listed as fallback and canonical: no self-redirect.
  expect(adminHostRedirects({ ADMIN_HOST: 'a.test', ADMIN_FALLBACK_HOST: 'a.test' }).some((redirect: Redirect) => redirect.source === '/:path*')).toBe(false);
});
