import type { Tenant } from '@lepefy/types';

export type AdminWorkspace = 'shop' | 'events';

export const EVENTS_ADMIN_PATH = '/admin/evenementiel';

/** Cookie UX only (last workspace used): never an authorization, the server re-checks every permission. */
export const ADMIN_WORKSPACE_COOKIE = 'lepefy_admin_ws';

function normalizeHost(hostname: string | null | undefined) {
  return (hostname ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    url.pathname = url.pathname.replace(/\/$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function getEventsHostname() {
  return normalizeHost(process.env.NEXT_PUBLIC_EVENTS_SUBDOMAIN);
}

/** Canonical Lepefy Admin host of the tenant (ADMIN_HOST), null while not configured. */
export function getAdminCanonicalHost() {
  return normalizeHost(process.env.ADMIN_HOST) || null;
}

/** Lepefy-provided entry point; redirects to the canonical host when one is configured. */
export function getAdminFallbackHost() {
  return normalizeHost(process.env.ADMIN_FALLBACK_HOST) || null;
}

export function isEventsAdminPath(pathname: string | null | undefined): boolean {
  const path = pathname ?? '';
  return path === EVENTS_ADMIN_PATH || path.startsWith(`${EVENTS_ADMIN_PATH}/`);
}

/**
 * The workspace follows the path (`/admin/evenementiel/**` is Événementiel,
 * everything else Boutique). The legacy events host still maps its whole admin
 * to Événementiel until it is retired.
 */
export function resolveAdminWorkspace(hostname: string | null | undefined, pathname?: string | null): AdminWorkspace {
  if (isEventsAdminPath(pathname)) return 'events';
  const host = normalizeHost(hostname);
  const eventsHost = getEventsHostname();
  return Boolean(host && eventsHost && host === eventsHost) ? 'events' : 'shop';
}

export function getAdminWorkspaceUrls(tenant: Pick<Tenant, 'storefront_url'>) {
  const shopBaseUrl = normalizeBaseUrl(tenant.storefront_url ?? process.env.NEXT_PUBLIC_APP_URL);
  const eventsBaseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_EVENTS_SUBDOMAIN);
  const adminHost = getAdminCanonicalHost();
  const adminBaseUrl = adminHost ? normalizeBaseUrl(adminHost) : shopBaseUrl;

  // On the unified admin origin both workspaces live under the same host:
  // relative links keep the installed app and its session.
  if (adminHost) {
    return { shopBaseUrl, eventsBaseUrl, adminBaseUrl, shopAdminUrl: '/admin', eventsAdminUrl: EVENTS_ADMIN_PATH };
  }

  return {
    shopBaseUrl,
    eventsBaseUrl,
    adminBaseUrl,
    shopAdminUrl: shopBaseUrl ? `${shopBaseUrl}/admin` : '/admin',
    eventsAdminUrl: eventsBaseUrl ? `${eventsBaseUrl}/admin` : EVENTS_ADMIN_PATH,
  };
}
