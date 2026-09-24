// Network-only storefront service worker.
// The previous worker cached "/" indefinitely and could serve obsolete HTML
// after a deployment. Never cache HTML, RSC payloads, or Next.js chunks here.
const LEGACY_CACHE_PREFIXES = ['chloefood-', 'lepefy-storefront-'];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

// No fetch handler: the browser uses its normal HTTP cache semantics.
// In particular, a failed navigation must not fall back to stale HTML.
