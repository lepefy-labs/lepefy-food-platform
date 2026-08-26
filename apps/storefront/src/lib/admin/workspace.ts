import type { Tenant } from '@lepefy/types';

export type AdminWorkspace = 'shop' | 'events';

function normalizeHost(hostname: string | null | undefined) {
  return (hostname ?? '').trim().toLowerCase().replace(/:\d+$/, '');
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

export function resolveAdminWorkspace(hostname: string | null | undefined): AdminWorkspace {
  const host = normalizeHost(hostname);
  const eventsHost = getEventsHostname();
  return Boolean(host && eventsHost && host === eventsHost) ? 'events' : 'shop';
}

export function getAdminWorkspaceUrls(tenant: Pick<Tenant, 'storefront_url'>) {
  const shopBaseUrl = normalizeBaseUrl(tenant.storefront_url ?? process.env.NEXT_PUBLIC_APP_URL);
  const eventsBaseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_EVENTS_SUBDOMAIN);

  return {
    shopBaseUrl,
    eventsBaseUrl,
    shopAdminUrl: shopBaseUrl ? `${shopBaseUrl}/admin` : '/admin',
    eventsAdminUrl: eventsBaseUrl ? `${eventsBaseUrl}/admin` : null,
  };
}
