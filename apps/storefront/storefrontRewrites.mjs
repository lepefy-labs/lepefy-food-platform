// Build-time rewrites of the storefront. Plain JS: next.config.mjs cannot import
// TypeScript. Unit-tested (tests/unit/storefrontRewrites.spec.ts).

// Link-preview robots: Meta's scraper (WhatsApp Business replies and shared links)
// and the WhatsApp app itself. They only read the <head>.
export const LINK_PREVIEW_USER_AGENT = '.*(?:facebookexternalhit|WhatsApp).*';

/**
 * - Events subdomain (NEXT_PUBLIC_EVENTS_SUBDOMAIN): its paths map to /evenementiel.
 * - Link-preview robots asking for the catalogue `/` get /apercu-catalogue, an ISR
 *   copy with the same metadata served from the CDN: `/` is dynamic, and each robot
 *   hit was a Vercel Function invocation (one every ~3 minutes in production).
 *   Customers never match it; `/` is never CDN-cached for them (force-dynamic).
 */
export function storefrontRewrites(env) {
  const eventsSubdomain = env.NEXT_PUBLIC_EVENTS_SUBDOMAIN;
  const beforeFiles = [];
  if (eventsSubdomain) {
    const onEventsHost = [{ type: 'host', value: eventsSubdomain }];
    beforeFiles.push(
      { source: '/admin', has: onEventsHost, destination: '/admin/evenementiel' },
      { source: '/', has: onEventsHost, destination: '/evenementiel' },
      { source: '/evenements/:path*', has: onEventsHost, destination: '/evenementiel/evenements/:path*' },
      { source: '/services/:path*', has: onEventsHost, destination: '/evenementiel/services/:path*' },
    );
  }
  beforeFiles.push({
    source: '/',
    has: [{ type: 'header', key: 'user-agent', value: LINK_PREVIEW_USER_AGENT }],
    ...(eventsSubdomain ? { missing: [{ type: 'host', value: eventsSubdomain }] } : {}),
    destination: '/apercu-catalogue',
  });
  return { beforeFiles };
}
