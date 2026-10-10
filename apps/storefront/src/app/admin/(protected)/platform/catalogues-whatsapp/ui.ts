/** Classi e etichette condivise dalle pagine "Catalogues WhatsApp" (console platform). */

export const INPUT = 'w-full rounded-lg border border-a-border bg-a-surface px-3 py-2 text-sm text-a-text focus:outline-none focus:ring-2 focus:ring-a-focus';
export const LABEL = 'mb-1 block text-xs font-medium text-a-text-3';
const BUTTON = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold disabled:opacity-50';
export const PRIMARY = `${BUTTON} bg-a-brand text-a-on-brand hover:opacity-90`;
export const SECONDARY = `${BUTTON} border border-a-border text-a-text-2 hover:bg-a-surface-2`;
export const CARD = 'rounded-2xl border border-a-border bg-a-surface p-5';

export type ItemStatus = 'new' | 'changed' | 'linked' | 'dismissed' | 'unavailable';

export const ITEM_STATUS: Record<ItemStatus, { label: string; cls: string }> = {
  new: { label: 'Nouveau', cls: 'bg-tone-warning-bg text-tone-warning-fg' },
  changed: { label: 'Modifié', cls: 'bg-tone-danger-bg text-tone-danger-fg' },
  linked: { label: 'Lié', cls: 'bg-tone-success-bg text-tone-success-fg' },
  dismissed: { label: 'Écarté', cls: 'bg-a-hover text-a-text-2' },
  unavailable: { label: 'Retiré du catalogue', cls: 'bg-a-hover text-a-text-2' },
};

export const CONSENT: Record<string, { label: string; cls: string }> = {
  granted: { label: 'Consentement enregistré', cls: 'bg-tone-success-bg text-tone-success-fg' },
  missing: { label: 'Consentement manquant', cls: 'bg-tone-warning-bg text-tone-warning-fg' },
  revoked: { label: 'Consentement retiré', cls: 'bg-tone-danger-bg text-tone-danger-fg' },
};

export function euro(value: number | null | undefined, currency = 'EUR'): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

/** `393296958822@c.us` → `+393296958822`. */
export function phoneFromChatId(chatId: string): string {
  return `+${chatId.replace(/@.*$/, '')}`;
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (body as { error?: string }).error ?? 'Opération impossible.' };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: 'Erreur réseau — réessayez.' };
  }
}

/**
 * Ordre de la liste filtrée de la source, conservé pour « Précédent / Suivant »
 * sur la fiche produit (sessionStorage : confort par onglet, jamais une donnée).
 */
function navKey(sourceId: string): string {
  return `lepefy:wa-catalog-nav:${sourceId}`;
}

export interface ItemNavigation {
  ids: string[];
  /** Query string de la liste (`?statut=todo&q=…`), pour revenir à la même vue. */
  search: string;
}

export function saveItemNavigation(sourceId: string, nav: ItemNavigation): void {
  try { sessionStorage.setItem(navKey(sourceId), JSON.stringify(nav)); } catch { /* stockage indisponible */ }
}

export function readItemNavigation(sourceId: string): ItemNavigation {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(navKey(sourceId)) ?? '{}') as Partial<ItemNavigation>;
    const ids = Array.isArray(parsed.ids) ? parsed.ids.filter((v): v is string => typeof v === 'string') : [];
    const search = typeof parsed.search === 'string' && /^(\?[\w%.+~=&-]*)?$/.test(parsed.search) ? parsed.search : '';
    return { ids, search };
  } catch {
    return { ids: [], search: '' };
  }
}
