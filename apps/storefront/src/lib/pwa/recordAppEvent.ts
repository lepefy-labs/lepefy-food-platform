import { isAppSource, type AppEvent, type AppSource } from './appInstall';

/**
 * Compte un événement de l'application installable (migration 186, compteurs
 * agrégés jour × événement × source). Aucune donnée du visiteur. N'échoue
 * jamais visiblement.
 */
export function recordAppEvent(event: AppEvent, source: AppSource): void {
  if (typeof window === 'undefined') return;
  try {
    const body = JSON.stringify({ event, source });
    const sent = typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon('/api/app/event', new Blob([body], { type: 'application/json' }));
    if (!sent) void fetch('/api/app/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    // Mesure facultative.
  }
}

const SOURCE_KEY = 'lepefy-app-source';

/** Source de la dernière visite de /app (session), pour attribuer `appinstalled`. */
export function rememberAppSource(source: AppSource): void {
  try { sessionStorage.setItem(SOURCE_KEY, source); } catch { /* stockage indisponible */ }
}

export function rememberedAppSource(fallback: AppSource): AppSource {
  try {
    const value = sessionStorage.getItem(SOURCE_KEY);
    if (isAppSource(value)) return value;
  } catch { /* stockage indisponible */ }
  return fallback;
}
