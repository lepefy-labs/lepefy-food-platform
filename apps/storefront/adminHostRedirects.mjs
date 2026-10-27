// Build-time redirects of the unified Lepefy Admin origin (docs/ADMIN_PWA.md).
// Plain JS: next.config.mjs cannot import TypeScript. Unit-tested.

function normalizeHost(value) {
  return (value ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}

// Everything the admin host does not serve as a page: the admin itself, APIs,
// Next assets, the service worker and static files (any path with a dot).
const NOT_SERVED_BY_ADMIN_HOST = '/:path((?!admin(?:/|$)|api/|_next/|sw\.js$|brand/|icons/|images/|badges/|favicon\.ico$)[^.]+)';

/**
 * Fallback host -> canonical host is temporary (307) so it can be withdrawn if
 * the custom domain is unavailable. On the admin host, storefront pages lead
 * to the admin. Returns [] while ADMIN_HOST is not configured (no behaviour change).
 */
export function adminHostRedirects(env) {
  const canonical = normalizeHost(env.ADMIN_HOST);
  const fallback = normalizeHost(env.ADMIN_FALLBACK_HOST);
  if (!canonical) return [];
  const redirects = [];
  if (fallback && fallback !== canonical) {
    redirects.push({ source: '/:path*', has: [{ type: 'host', value: fallback }], destination: `https://${canonical}/:path*`, permanent: false });
  }
  const onAdminHost = [{ type: 'host', value: canonical }];
  redirects.push({ source: '/', has: onAdminHost, destination: '/admin', permanent: false });
  redirects.push({ source: NOT_SERVED_BY_ADMIN_HOST, has: onAdminHost, destination: '/admin', permanent: false });
  return redirects;
}
