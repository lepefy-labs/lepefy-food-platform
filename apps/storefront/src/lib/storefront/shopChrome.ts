/**
 * Éléments de navigation partagés du layout boutique : où la recherche globale
 * et le bandeau défilant apparaissent. Règles pures, testées, lues par les
 * composants clients du layout (qui ne lit jamais cookies ni session).
 */

/** Parcours où une recherche distrairait ou interférerait avec un formulaire sensible. */
const SEARCH_HIDDEN_PREFIXES = ['/checkout', '/order-confirmation', '/supprimer-compte'];
const SEARCH_HIDDEN_PATHS = new Set(['/avis/donner']);

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function shouldShowGlobalSearch(pathname: string): boolean {
  if (SEARCH_HIDDEN_PATHS.has(pathname)) return false;
  return !SEARCH_HIDDEN_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

/** Le catalogue possède la recherche : le même champ y filtre la grille au lieu de proposer. */
export function isCatalogSearchPath(pathname: string): boolean {
  return pathname === '/';
}

/** Le bandeau défilant ne sert qu'à la découverte : jamais sur les pages d'achat. */
export function shouldShowPromoTicker(pathname: string): boolean {
  return pathname === '/accueil';
}

/** Parcours de paiement : aucune animation de rappel du panier. */
export function isCheckoutPath(pathname: string): boolean {
  return matchesPrefix(pathname, '/checkout');
}
