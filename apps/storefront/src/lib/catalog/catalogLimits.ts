/**
 * Bornes du catalogue partagées entre serveur et client (module sans
 * dépendance serveur : importable par les composants clients).
 */

/** Maximum de produits exclus d'une liste (`/api/products?exclude=` : deux blocs de 10 cartes). */
export const MAX_EXCLUDED_IDS = 20;
