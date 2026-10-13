import type { CatalogSort } from './pagination';

export interface CatalogUrlOverrides {
  /** `undefined` conserve la recherche de l'URL courante. */
  q?: string;
  /** `null` retire le filtre catégorie ; `undefined` le conserve. */
  category?: string | null;
  sort?: CatalogSort;
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
    if (q) params.set('q', q);
    else params.delete('q');
  }
  if (overrides.category !== undefined) {
    if (overrides.category) params.set('category', overrides.category);
    else params.delete('category');
    params.delete('quantityGroup');
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

/** Lien « Voir tous les résultats » depuis n'importe quelle page. */
export function catalogSearchHref(query: string): string {
  return buildCatalogUrl('/', '', { q: query });
}
