import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { LINK_PREVIEW_USER_AGENT, storefrontRewrites } from '../../storefrontRewrites.mjs';

// Next.js matches a `has` header value as a whole-string regular expression.
const isPreviewRobot = (userAgent: string) => new RegExp(`^(?:${LINK_PREVIEW_USER_AGENT})$`).test(userAgent);

test.describe('storefront rewrites', () => {
  test('link-preview robots asking for the catalogue get the cached copy', () => {
    const { beforeFiles } = storefrontRewrites({});
    expect(beforeFiles).toEqual([{
      source: '/',
      has: [{ type: 'header', key: 'user-agent', value: LINK_PREVIEW_USER_AGENT }],
      destination: '/apercu-catalogue',
    }]);
  });

  test('only robot user agents match, never a browser', () => {
    expect(isPreviewRobot('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)')).toBe(true);
    expect(isPreviewRobot('WhatsApp/2.23.20.0 A')).toBe(true);
    expect(isPreviewRobot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(isPreviewRobot('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36')).toBe(false);
    // Instagram / Facebook in-app browsers are customers, not robots.
    expect(isPreviewRobot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]')).toBe(false);
  });

  test('the events subdomain keeps its own home, robots included', () => {
    const { beforeFiles } = storefrontRewrites({ NEXT_PUBLIC_EVENTS_SUBDOMAIN: 'events.chloefood.com' });
    expect(beforeFiles.map((rule) => rule.destination)).toEqual([
      '/admin/evenementiel', '/evenementiel', '/evenementiel/evenements/:path*', '/evenementiel/services/:path*', '/apercu-catalogue',
    ]);
    const robotRule = beforeFiles.at(-1) as { missing?: unknown } | undefined;
    expect(robotRule?.missing).toEqual([{ type: 'host', value: 'events.chloefood.com' }]);
  });

  test('the catalogue and its robot copy announce the same page', () => {
    const appFile = (file: string) => readFileSync(path.join(__dirname, '../../src/app', file), 'utf8');
    expect(appFile('(shop)/page.tsx')).toContain('catalogMetadata(tenant.name)');
    expect(appFile('apercu-catalogue/page.tsx')).toContain('...catalogMetadata(tenant.name)');
  });
});
