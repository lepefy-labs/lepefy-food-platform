import type { HelpArticleSummary, HelpArticleView, HelpEvent } from '@/lib/helpCenter/domain';

/** Browser-side calls of the Help Center (same-origin, cookie session). */

export interface HelpContextPayload {
  route: string | null;
  primary: HelpArticleSummary[];
  related: HelpArticleSummary[];
  fallback: boolean;
  localeFallback: boolean;
}

export interface HelpArticlePayload {
  article: HelpArticleView;
  related: HelpArticleSummary[];
  localeFallback: boolean;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (response.status === 429) throw new Error('Trop de recherches. Réessayez dans une minute.');
  if (!response.ok) throw new Error(response.status === 404 ? 'Guide introuvable.' : 'Le Centre d’aide est momentanément indisponible.');
  return response.json() as Promise<T>;
}

export const fetchHelpContext = (pathname: string, signal?: AbortSignal) =>
  getJson<HelpContextPayload>(`/api/admin/help/context?pathname=${encodeURIComponent(pathname)}`, signal);

export const fetchHelpSearch = (query: string, signal?: AbortSignal) =>
  getJson<{ results: HelpArticleSummary[] }>(`/api/admin/help/search?q=${encodeURIComponent(query)}`, signal);

export const fetchHelpArticle = (slug: string, signal?: AbortSignal) =>
  getJson<HelpArticlePayload>(`/api/admin/help/articles/${encodeURIComponent(slug)}`, signal);

/** Fire-and-forget metric: never awaited by the UI, never throws. */
export function sendHelpEvent(slug: string, event: HelpEvent): void {
  try {
    void fetch('/api/admin/help/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, event }),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {});
  } catch {
    /* metrics are best effort */
  }
}

/** Shareable link of a guide (opens the dedicated page). */
export const helpArticleHref = (slug: string) => `/admin/aide/${encodeURIComponent(slug)}`;
