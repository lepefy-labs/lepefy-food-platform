// HTTP caching of GET /api/quantity-groups.
//
// The payload is public tenant configuration (group name, minimum, step,
// member product ids): no session, no customer data, nothing read from the
// request. Each Vercel project serves one tenant on its own hosts, and the
// CDN keys on host + path, so an entry is never shared between tenants.
// An admin change reaches shoppers within s-maxage + stale-while-revalidate
// (≤ 2 min); /api/checkout always re-validates the rules server-side.
export const QUANTITY_GROUPS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=60';

/** A failure must never be cached: the next request retries the database. */
export const QUANTITY_GROUPS_ERROR_CACHE_CONTROL = 'no-store';
