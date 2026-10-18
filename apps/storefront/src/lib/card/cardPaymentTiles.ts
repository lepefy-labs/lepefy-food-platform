import { PAYMENT_METHOD_REGISTRY, type TenantPaymentMethod } from '@lepefy/types';
import { isOnlineCardMethod, isRevolutMethod } from './cardPaymentBrands';

/**
 * Grille des moyens de paiement de la landing /card. Pur, testé dans
 * tests/unit/cardLanding.spec.ts.
 *
 * - Entrée : les méthodes déjà filtrées par `visibleCardPaymentMethods`
 *   (module `card`, Apple Pay seulement si activé ET supporté).
 * - Les espèces ne sont jamais proposées depuis /card (`cardLandingMethods`) :
 *   la ligne `cash` reste active pour les autres modules.
 * - Une seule tuile « Carte » (Visa + Mastercard = la même ligne `card`), une
 *   seule tuile Apple Pay ; chaque autre ligne configurée garde sa tuile (même
 *   inconnue, avec son libellé réel).
 * - Grille de 4 colonnes logiques, sans cellule vide : chaque ligne de la
 *   grille est complétée en élargissant ses tuiles.
 */
export type CardPaymentTileKind = 'card' | 'apple_pay' | 'paypal' | 'satispay' | 'revolut' | 'bank_transfer' | 'other';

export type CardPaymentTileSpan = 1 | 2 | 3 | 4;

export interface CardPaymentTile {
  /** Id de la ligne `tenant_payment_methods` ouverte par la tuile. */
  methodId: string;
  kind: CardPaymentTileKind;
  /** Libellé configuré (tuiles `other`, repli sur le libellé du registre), sinon null. */
  label: string | null;
  span: CardPaymentTileSpan;
}

export const CARD_TILE_COLUMNS = 4;

const ORDER: CardPaymentTileKind[] = ['card', 'apple_pay', 'paypal', 'satispay', 'revolut', 'bank_transfer', 'other'];

/** Carte, virement et méthodes à libellé libre ont besoin de deux colonnes. */
const PREFERRED_SPAN: Record<CardPaymentTileKind, 1 | 2> = {
  card: 2, apple_pay: 1, paypal: 1, satispay: 1, revolut: 1, bank_transfer: 2, other: 2,
};

/** Méthodes proposées depuis /card : tout sauf les espèces. */
export function cardLandingMethods<T extends Pick<TenantPaymentMethod, 'method'>>(methods: ReadonlyArray<T>): T[] {
  return methods.filter((m) => m.method !== 'cash');
}

export function cardTileKind(method: Pick<TenantPaymentMethod, 'method' | 'label'>): CardPaymentTileKind | null {
  switch (method.method) {
    case 'cash': return null;
    case 'other': return isRevolutMethod(method) ? 'revolut' : 'other';
    default: return method.method;
  }
}

/** Largeurs : lignes de 4 colonnes remplies dans l'ordre, une ligne incomplète est étirée. */
function layoutSpans(preferred: ReadonlyArray<1 | 2>): CardPaymentTileSpan[] {
  const rows: number[][] = [];
  let row: number[] = [];
  let used = 0;
  preferred.forEach((span, index) => {
    if (used + span > CARD_TILE_COLUMNS) { rows.push(row); row = []; used = 0; }
    row.push(index);
    used += span;
  });
  if (row.length > 0) rows.push(row);

  const spans: CardPaymentTileSpan[] = preferred.map((span) => span);
  for (const indices of rows) {
    const total = indices.reduce((sum, i) => sum + preferred[i]!, 0);
    if (total === CARD_TILE_COLUMNS) continue;
    if (indices.length === 1) spans[indices[0]!] = 4;
    else if (indices.length === 2) indices.forEach((i) => { spans[i] = 2; });
    else {
      // Trois tuiles d'une colonne : la première prend la colonne restante.
      indices.forEach((i) => { spans[i] = 1; });
      spans[indices[0]!] = 2;
    }
  }
  return spans;
}

export function cardPaymentTiles(methods: ReadonlyArray<Pick<TenantPaymentMethod, 'id' | 'method' | 'label'>>): CardPaymentTile[] {
  const seenOnline = new Set<string>();
  const entries: Array<{ method: Pick<TenantPaymentMethod, 'id' | 'method' | 'label'>; kind: CardPaymentTileKind; index: number }> = [];
  methods.forEach((method, index) => {
    const kind = cardTileKind(method);
    if (!kind) return;
    if (isOnlineCardMethod(method)) {
      if (seenOnline.has(method.method)) return;
      seenOnline.add(method.method);
    }
    entries.push({ method, kind, index });
  });
  entries.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.index - b.index);
  const spans = layoutSpans(entries.map((entry) => PREFERRED_SPAN[entry.kind]));
  return entries.map((entry, i) => ({
    methodId: entry.method.id,
    kind: entry.kind,
    label: entry.kind === 'other' ? (entry.method.label?.trim() || PAYMENT_METHOD_REGISTRY.other.label) : null,
    span: spans[i]!,
  }));
}

/**
 * Écran ouvert par une tuile : flux Stripe (carte, Apple Pay) ou détail du
 * moyen externe. Null si l'id ne correspond à aucune méthode proposée — l'écran
 * de choix reprend alors sa sélection par défaut.
 */
export type CardPaymentEntry<T> = { screen: 'online'; method: T } | { screen: 'detail'; method: T };

export function resolveCardPaymentEntry<T extends Pick<TenantPaymentMethod, 'id' | 'method'>>(methods: ReadonlyArray<T>, methodId: string | null | undefined): CardPaymentEntry<T> | null {
  if (!methodId) return null;
  const method = methods.find((m) => m.id === methodId && m.method !== 'cash');
  if (!method) return null;
  return isOnlineCardMethod(method) ? { screen: 'online', method } : { screen: 'detail', method };
}
