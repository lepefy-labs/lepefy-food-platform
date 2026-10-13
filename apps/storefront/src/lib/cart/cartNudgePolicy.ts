/**
 * Rappel discret du panier dans la BottomNav. Règle pure : la fréquence est
 * bornée ici, jamais par un timer dans un composant. Le rappel ne part que sur
 * un événement réel (ouverture d'une nouvelle page), jamais sur un rendu ou une
 * synchronisation du panier.
 */

export const CART_NUDGE_MIN_INTERVAL_MS = 10 * 60_000;
export const CART_NUDGE_MAX_PER_SESSION = 2;
/** Délai de calme après une action panier (ajout, ouverture) avant tout rappel. */
export const CART_NUDGE_QUIET_MS = 3 * 60_000;
export const CART_NUDGE_STORAGE_KEY = 'lepefy-cart-nudges';

export interface CartNudgeInput {
  now: number;
  itemCount: number;
  onCartOrCheckout: boolean;
  drawerOpen: boolean;
  confirmationOpen: boolean;
  reducedMotion: boolean;
  documentHidden: boolean;
  /** Début du suivi dans cet onglet : le calme vaut aussi à l'arrivée. */
  sessionStartedAt: number;
  lastAddAt: number | null;
  lastCartViewAt: number | null;
  /** Horodatages des rappels déjà joués dans la session. */
  history: number[];
}

export function shouldNudgeCart(input: CartNudgeInput): boolean {
  if (input.itemCount <= 0) return false;
  if (input.onCartOrCheckout || input.drawerOpen || input.confirmationOpen) return false;
  if (input.reducedMotion || input.documentHidden) return false;
  if (input.history.length >= CART_NUDGE_MAX_PER_SESSION) return false;
  const lastNudge = input.history.length ? Math.max(...input.history) : null;
  if (lastNudge !== null && input.now - lastNudge < CART_NUDGE_MIN_INTERVAL_MS) return false;
  const lastActivity = Math.max(input.sessionStartedAt, input.lastAddAt ?? 0, input.lastCartViewAt ?? 0);
  return input.now - lastActivity >= CART_NUDGE_QUIET_MS;
}

/** Lecture tolérante de l'historique (stockage bloqué, valeur corrompue). */
export function parseNudgeHistory(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).slice(-CART_NUDGE_MAX_PER_SESSION)
      : [];
  } catch {
    return [];
  }
}
