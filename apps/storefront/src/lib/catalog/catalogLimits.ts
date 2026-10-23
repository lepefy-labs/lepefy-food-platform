/**
 * Bornes du catalogue partagées entre serveur et client (module sans
 * dépendance serveur : importable par les composants clients).
 */

/** Maximum de produits exclus d'une liste (`/api/products?exclude=` : trois blocs de 10 cartes — promos, nouveautés, petits plus). */
export const MAX_EXCLUDED_IDS = 30;
