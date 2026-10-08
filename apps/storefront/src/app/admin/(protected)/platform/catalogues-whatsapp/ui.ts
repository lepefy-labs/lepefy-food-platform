/** Classi e etichette condivise dalle pagine "Catalogues WhatsApp" (console platform). */

export const INPUT = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
export const LABEL = 'mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400';
const BUTTON = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold disabled:opacity-50';
export const PRIMARY = `${BUTTON} bg-[var(--admin-primary)] text-white hover:opacity-90`;
export const SECONDARY = `${BUTTON} border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800`;
export const CARD = 'rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900';

export type ItemStatus = 'new' | 'changed' | 'linked' | 'dismissed' | 'unavailable';

export const ITEM_STATUS: Record<ItemStatus, { label: string; cls: string }> = {
  new: { label: 'Nouveau', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' },
  changed: { label: 'Modifié', cls: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200' },
  linked: { label: 'Lié', cls: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-200' },
  dismissed: { label: 'Écarté', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  unavailable: { label: 'Retiré du catalogue', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
};

export const CONSENT: Record<string, { label: string; cls: string }> = {
  granted: { label: 'Consentement enregistré', cls: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-200' },
  missing: { label: 'Consentement manquant', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200' },
  revoked: { label: 'Consentement retiré', cls: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-200' },
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
