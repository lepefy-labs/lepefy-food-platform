/**
 * Compte un ajout au panier fait depuis une suggestion (migration 165,
 * compteurs agrégés jour × emplacement × produit). Aucune donnée du visiteur :
 * seulement le produit et l'emplacement. Ne bloque jamais l'ajout et
 * n'échoue jamais visiblement.
 */
export type AddSourcePlacement = 'cart_suggestions' | 'cart_fits' | 'add_confirmation';

export function recordAddSource(productId: string, placement: AddSourcePlacement): void {
  if (typeof window === 'undefined') return;
  try {
    const body = JSON.stringify({ productId, placement });
    const sent = typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon('/api/cart/add-source', new Blob([body], { type: 'application/json' }));
    if (!sent) void fetch('/api/cart/add-source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch {
    // Mesure facultative.
  }
}
