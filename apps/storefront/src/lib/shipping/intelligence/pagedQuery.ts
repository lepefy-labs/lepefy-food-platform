/**
 * PostgREST plafonne silencieusement chaque réponse (max-rows = 1000 sur
 * Supabase) — un `.limit(2500)` ne renvoie donc jamais plus de 1000 lignes.
 * Toute lecture qui doit être exhaustive (campagne de 2000 items, jeu
 * d'observations) passe par une pagination explicite `.range()` sur un ordre
 * stable.
 */
export const POSTGREST_PAGE_SIZE = 1000;

export interface PagedResult<T> {
  rows: T[];
  truncated: boolean;
  error: string | null;
}

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  options?: { pageSize?: number; maxRows?: number },
): Promise<PagedResult<T>> {
  const pageSize = options?.pageSize ?? POSTGREST_PAGE_SIZE;
  const maxRows = options?.maxRows ?? 20_000;
  const rows: T[] = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) return { rows, truncated: false, error: error.message };
    const page = data ?? [];
    rows.push(...page);
    // Une page incomplète marque la fin : pageSize ne doit donc jamais
    // dépasser le plafond serveur (1000), sinon une page plafonnée serait
    // prise à tort pour la dernière.
    if (page.length < to - from + 1) return { rows, truncated: false, error: null };
  }
  return { rows, truncated: true, error: null };
}

/** Découpe une liste d'ids pour `.in()` : une URL PostgREST de 2000 UUID dépasse les limites HTTP. */
export function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
