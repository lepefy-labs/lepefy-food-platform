// Prefetch policy of the shop navigation links (header, bottom bar, menu,
// footer, catalogue shortcuts).
//
// Next.js 14 prefetches every <Link> that enters the viewport in production.
// For a page served from the ISR/static cache that prefetch is a CDN hit; for
// a dynamic page (catalogue with its filters, cart, account, orders…) it is a
// Vercel Function invocation, repeated on every page view whether or not the
// visitor goes there. Those links keep a normal client navigation (the
// `loading.tsx` shell shows immediately) but no speculative prefetch.

/** Shop pages rendered from the ISR/static cache: prefetching them costs no function. */
const CACHED_PATHS = new Set([
  '/accueil',
  '/avis',
  '/card',
  '/evenementiel',
  '/politique-confidentialite',
  '/conditions-generales-vente',
]);
const CACHED_PREFIXES = ['/products/'];

/**
 * Value for the `prefetch` prop of a shop <Link>: `undefined` keeps Next's
 * default for cached pages, `false` disables it for dynamic or personal ones.
 */
export function shopLinkPrefetch(href: string): false | undefined {
  if (!href.startsWith('/') || href.startsWith('//')) return undefined;
  const [withoutHash] = href.split('#');
  const [pathname, query] = withoutHash!.split('?');
  // Filtered views (?category=, ?promo=1, ?quantityGroup=…) are rendered per request.
  if (query) return false;
  const path = pathname!.length > 1 ? pathname!.replace(/\/+$/, '') : pathname!;
  if (CACHED_PATHS.has(path) || CACHED_PREFIXES.some(prefix => path.startsWith(prefix))) return undefined;
  return false;
}
