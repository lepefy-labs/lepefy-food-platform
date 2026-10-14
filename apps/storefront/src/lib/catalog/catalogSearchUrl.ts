import type { CatalogSort } from './pagination';

export interface CatalogUrlOverrides {
  /** `undefined` conserve la recherche de l'URL courante. */
  q?: string;
  /** `null` retire le filtre catégorie ; `undefined` le conserve. */
  category?: string | null;
  sort?: CatalogSort;
  /** `true` ouvre « Nos promos » (sans recherche, catégorie ni groupe) ; `false` la ferme. */
  promo?: boolean;
  /** `true` ouvre « Nouveautés » (même règle que les promos) ; `false` la ferme. */
  novelty?: boolean;
}

/**
 * URL du Catalogue après un changement de recherche, catégorie ou tri.
 * Partagée par le champ de recherche global et par CatalogClient, pour que
 * les deux appliquent toujours les mêmes règles : un nouveau filtre repart de
 * la page 1 avec le classement du jour, une catégorie efface le groupe à compléter.
 */
export function buildCatalogUrl(pathname: string, current: string | URLSearchParams, overrides: CatalogUrlOverrides): string {
  const params = new URLSearchParams(current);
  if (overrides.q !== undefined) {
    const q = overrides.q.trim();
    if (q) { params.set('q', q); params.delete('promo'); params.delete('new'); }
    else params.delete('q');
  }
  if (overrides.category !== undefined) {
    if (overrides.category) params.set('category', overrides.category);
    else params.delete('category');
    params.delete('quantityGroup');
    params.delete('promo');
    params.delete('new');
  }
  if (overrides.promo === true) {
    params.set('promo', '1');
    for (const key of ['q', 'category', 'quantityGroup', 'new']) params.delete(key);
  } else if (overrides.promo === false) {
    params.delete('promo');
  }
  if (overrides.novelty === true) {
    params.set('new', '1');
    for (const key of ['q', 'category', 'quantityGroup', 'promo']) params.delete(key);
  } else if (overrides.novelty === false) {
    params.delete('new');
  }
  if (overrides.sort !== undefined) {
    if (overrides.sort === 'recommended') params.delete('sort');
    else params.set('sort', overrides.sort);
  }
  params.delete('day');
  params.delete('page');
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ''}`;
}

/** Accès « Nos promos » depuis n'importe quelle page (catalogue filtré sur les promotions). */
export const CATALOG_PROMOS_HREF = '/?promo=1';

/** Accès « Nouveautés » depuis n'importe quelle page. */
export const CATALOG_NOVELTIES_HREF = '/?new=1';

/** `?promo=1` / `?new=1` : seule la valeur 1 est reconnue. */
export function isPromoFilter(value: string | null | undefined): boolean {
  return value === '1';
}

/** Lien « Voir tous les résultats » depuis n'importe quelle page. */
export function catalogSearchHref(query: string): string {
  return buildCatalogUrl('/', '', { q: query });
}
