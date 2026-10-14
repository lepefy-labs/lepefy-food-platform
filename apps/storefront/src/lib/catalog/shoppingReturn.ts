/**
 * A single, same-origin catalogue return destination shared by PDP and cart.
 * Never persist a third-party URL, product route, checkout route or arbitrary
 * query parameters. Direct visitors fall back to the shop catalogue.
 *
 * The catalogue records its own URL (search, category, sort, promo, the
 * `?page=N` reached by infinite scroll) and scroll position while it is shown,
 * so « Continuer mes achats » works even when the cart was opened from the
 * bottom navigation. The position is restored only after an explicit return
 * (`markShoppingReturn`), never on a plain visit, and only for the same URL:
 * `?page=N` makes the server render the same cumulative list, so the offset
 * points at the same products.
 */
const KEY = 'lepefy-shopping-return';
const SCROLL_KEY = 'lepefy-shopping-return-scroll';
const RESTORE_KEY = 'lepefy-shopping-return-restore';
const CATALOG_PATHS = new Set(['/', '/gadgets']);
const FILTERS = ['category', 'q', 'sort', 'day', 'page', 'quantityGroup', 'promo', 'new'];

/** Same-origin catalogue path + allow-listed filters, or null for any other page. */
export function safeCatalogTarget(pathname: string, search: string): string | null {
  if (!CATALOG_PATHS.has(pathname)) return null;
  const input = new URLSearchParams(search);
  const safe = new URLSearchParams();
  for (const key of FILTERS) {
    const value = input.get(key);
    if (value && value.length <= 160) safe.set(key, value);
  }
  return pathname + (safe.size ? `?${safe.toString()}` : '');
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage; } catch { return null; }
}

export function rememberShoppingReturn(location: { pathname: string; search: string }): void {
  const target = safeCatalogTarget(location.pathname, location.search);
  if (!target) return;
  try { storage()?.setItem(KEY, target); } catch { /* storage disabled */ }
}

/** URL + scroll of the catalogue currently shown (called on mount and while scrolling). */
export function rememberCatalogPosition(location: { pathname: string; search: string }, scrollY: number): void {
  const target = safeCatalogTarget(location.pathname, location.search);
  if (!target) return;
  try {
    storage()?.setItem(KEY, target);
    storage()?.setItem(SCROLL_KEY, JSON.stringify({ target, y: Math.max(0, Math.round(scrollY)) }));
  } catch { /* storage disabled */ }
}

/** Called by « Continuer mes achats » / « Retour au catalogue » just before navigating. */
export function markShoppingReturn(): void {
  try { storage()?.setItem(RESTORE_KEY, '1'); } catch { /* storage disabled */ }
}

/**
 * Scroll offset to restore on the catalogue just reached, consumed once.
 * Null on a plain visit, for another URL or when nothing was recorded.
 */
export function takeCatalogScrollRestore(location: { pathname: string; search: string }): number | null {
  const store = storage();
  if (!store) return null;
  try {
    const requested = store.getItem(RESTORE_KEY) === '1';
    store.removeItem(RESTORE_KEY);
    if (!requested) return null;
    const saved = JSON.parse(store.getItem(SCROLL_KEY) ?? 'null') as { target?: unknown; y?: unknown } | null;
    const target = safeCatalogTarget(location.pathname, location.search);
    if (!saved || !target || saved.target !== target || typeof saved.y !== 'number' || !Number.isFinite(saved.y)) return null;
    return Math.max(0, saved.y);
  } catch { return null; }
}

export function getShoppingReturn(fallback = '/'): string {
  if (typeof window === 'undefined') return fallback;
  try {
    const saved = storage()?.getItem(KEY);
    if (!saved || saved.startsWith('//') || saved.includes('#')) return fallback;
    const parsed = new URL(saved, window.location.origin);
    if (parsed.origin !== window.location.origin) return fallback;
    return safeCatalogTarget(parsed.pathname, parsed.search) ?? fallback;
  } catch { return fallback; }
}
