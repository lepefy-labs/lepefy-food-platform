/**
 * A single, same-origin catalogue return destination shared by PDP and cart.
 * Never persist a third-party URL, product route, checkout route or arbitrary
 * query parameters. Direct visitors fall back to the shop catalogue.
 */
const KEY = 'lepefy-shopping-return';
const CATALOG_PATHS = new Set(['/', '/gadgets']);
const FILTERS = ['category', 'q', 'sort', 'day', 'page', 'quantityGroup'];

export function rememberShoppingReturn(location: { pathname: string; search: string }): void {
  if (typeof window === 'undefined' || !CATALOG_PATHS.has(location.pathname)) return;
  const input = new URLSearchParams(location.search);
  const safe = new URLSearchParams();
  for (const key of FILTERS) {
    const value = input.get(key);
    if (value && value.length <= 160) safe.set(key, value);
  }
  const target = location.pathname + (safe.size ? `?${safe.toString()}` : '');
  try { window.sessionStorage.setItem(KEY, target); } catch { /* storage disabled */ }
}

export function getShoppingReturn(fallback = '/'): string {
  if (typeof window === 'undefined') return fallback;
  try {
    const saved = window.sessionStorage.getItem(KEY);
    if (!saved || saved.startsWith('//') || saved.includes('#')) return fallback;
    const parsed = new URL(saved, window.location.origin);
    if (parsed.origin !== window.location.origin || !CATALOG_PATHS.has(parsed.pathname)) return fallback;
    const clean = new URLSearchParams();
    for (const key of FILTERS) {
      const value = parsed.searchParams.get(key);
      if (value && value.length <= 160) clean.set(key, value);
    }
    return parsed.pathname + (clean.size ? `?${clean.toString()}` : '');
  } catch { return fallback; }
}
