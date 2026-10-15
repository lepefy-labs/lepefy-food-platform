import { PRODUCT_CARD_SELECT } from './productCardSelect';
import { rankSimilarProducts } from './similarProductSearch';
import type { createClient } from '@/lib/supabase/server';

type SupabaseClient = ReturnType<typeof createClient>;

/** Plafond de noms comparés (catalogues de boutique : quelques centaines de produits). */
const MAX_CANDIDATES = 2000;
const MAX_QUERY_LENGTH = 100;

/**
 * Produits au nom proche d'une recherche mal orthographiée : mêmes filtres
 * que le catalogue (tenant, actif, catégories de la boutique), seuls les noms
 * sont lus pour le classement (`rankSimilarProducts`), puis les lignes
 * complètes des meilleurs (prix et stock frais, projection des cartes).
 * Les produits déjà trouvés par la recherche exacte sont exclus.
 */
export async function getSimilarProducts(
  supabase: SupabaseClient,
  tenantId: string,
  categoryIds: string[],
  query: string,
  excludeIds: string[],
  limit: number,
): Promise<unknown[]> {
  const q = query.trim().slice(0, MAX_QUERY_LENGTH);
  if (!q || !categoryIds.length || limit <= 0) return [];
  const { data: candidates, error } = await supabase
    .from('products')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .in('category_id', categoryIds)
    .limit(MAX_CANDIDATES);
  if (error || !candidates) return [];
  const excluded = new Set(excludeIds);
  const ranked = rankSimilarProducts(q, (candidates as Array<{ id: string; name: string }>).filter((c) => !excluded.has(c.id)), limit);
  if (!ranked.length) return [];
  const ids = ranked.map((candidate) => candidate.id);
  const { data: rows, error: rowsError } = await supabase
    .from('products')
    .select(PRODUCT_CARD_SELECT)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .in('id', ids);
  if (rowsError || !rows) return [];
  const byId = new Map((rows as unknown as Array<{ id: string }>).map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is { id: string } => Boolean(row));
}
