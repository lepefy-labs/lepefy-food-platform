import { EVENTS_ADMIN_PATH } from './workspace';

/**
 * Host policy of the unified Lepefy Admin origin (docs/ADMIN_PWA.md). Pure
 * functions fed by the middleware; the build-time redirects live in
 * adminHostRedirects.mjs (next.config cannot import TypeScript).
 */

export function normalizeAdminHost(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}

/** Installed app launched from the icon (`?source=pwa`): reopen the last workspace, never grant it. */
export function pwaLaunchRedirect(input: { pathname: string; source: string | null; workspaceCookie: string | undefined }): string | null {
  if (input.pathname !== '/admin' || input.source !== 'pwa') return null;
  return input.workspaceCookie === 'events' ? EVENTS_ADMIN_PATH : null;
}

/**
 * Optional, off by default (ADMIN_LEGACY_REDIRECT=1): the old /admin pages on
 * the storefront host move to the canonical admin host. The invite page is
 * excluded because its token travels in the URL fragment, which a redirect drops.
 */
export function legacyAdminRedirect(input: {
  enabled: boolean;
  canonicalHost: string;
  storefrontHost: string;
  host: string;
  pathname: string;
  search: string;
}): string | null {
  const host = normalizeAdminHost(input.host);
  if (!input.enabled || !input.canonicalHost || !input.storefrontHost) return null;
  if (host !== input.storefrontHost || host === input.canonicalHost) return null;
  if (input.pathname !== '/admin' && !input.pathname.startsWith('/admin/')) return null;
  if (input.pathname === '/admin/accept-invite' || input.pathname.startsWith('/admin/accept-invite/')) return null;
  return `https://${input.canonicalHost}${input.pathname}${input.search}`;
}
