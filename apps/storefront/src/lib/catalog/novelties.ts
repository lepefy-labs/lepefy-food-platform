/**
 * Nouveautés choisies par le commerçant (migration 156) : `products.new_until`.
 * Un produit est une nouveauté jusqu'à cette date ; le tick n8n
 * (`apply_product_promotion_schedule`) vide ensuite la colonne, donc les
 * cards se contentent de la donnée (aucune horloge côté client, aucun écart
 * d'hydratation). Les listes serveur filtrent en plus sur la date, pour ne
 * jamais compter une nouveauté échue avant le passage du tick.
 *
 * À ne pas confondre avec le tri « Derniers ajoutés » (date de création).
 */

import { hasPurchasableQuantity } from '../purchaseQuantityRules';
import { PRODUCT_CARD_SELECT } from './productCardSelect';
import type { createClient } from '@/lib/supabase/server';

export interface NoveltyFields {
  new_until?: string | null;
}

export interface NoveltyCandidate extends NoveltyFields {
  id: string;
  stock: number | null;
  min_order_quantity: number;
  order_quantity_step: number;
}

/** Badge « Nouveau » d'une card : la donnée suffit (vidée par le tick à échéance). */
export function hasNoveltyBadge(product: NoveltyFields): boolean {
  return Boolean(product.new_until);
}

/** Nouveauté encore valable à cet instant et achetable (listes, compteurs). */
export function isActiveNovelty(product: NoveltyCandidate, now: number = Date.now()): boolean {
  if (!product.new_until) return false;
  const until = Date.parse(product.new_until);
  if (Number.isNaN(until) || until <= now) return false;
  return hasPurchasableQuantity(product.stock ?? 999, product.min_order_quantity || 1, product.order_quantity_step || 1);
}

/** Durées proposées dans l'éditeur. */
export const NOVELTY_DURATIONS_DAYS = [7, 14, 30] as const;
export const DEFAULT_NOVELTY_DAYS = 14;

/** Fin d'une nouveauté de `days` jours à partir de maintenant (ISO). */
export function noveltyUntil(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() + Math.max(1, Math.trunc(days)) * 86_400_000).toISOString();
}

export const NOVELTY_COPY = {
  invalidDate: 'Date de fin de nouveauté invalide.',
  pastDate: 'La date de fin de nouveauté doit être dans le futur.',
} as const;

/** Valeur de `new_until` envoyée par l'éditeur : null (retirer) ou une date future. */
export function parseNoveltyUntil(raw: unknown, now: Date = new Date()): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: NOVELTY_COPY.invalidDate };
  const until = Date.parse(raw);
  if (Number.isNaN(until)) return { ok: false, error: NOVELTY_COPY.invalidDate };
  if (until <= now.getTime()) return { ok: false, error: NOVELTY_COPY.pastDate };
  return { ok: true, value: new Date(until).toISOString() };
}

/** Nouveautés actives, les plus récentes d'abord, sans doublon. */
export function selectActiveNovelties<T extends NoveltyCandidate>(rows: readonly T[], now: number = Date.now()): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id) || !isActiveNovelty(row, now)) return false;
    seen.add(row.id);
    return true;
  });
}

export const NOVELTIES_QUERY_LIMIT = 200;
/** Cartes de la rangée « Nouveautés » de Découvrir. */
export const NOVELTIES_ROW_LIMIT = 8;
/** Cartes du bloc « Nouveautés » du catalogue (même limite que le bloc Promos). */
export const NOVELTIES_SHELF_LIMIT = 10;

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * Nouveautés actives du tenant, limitées aux catégories boutique reçues.
 * Toujours filtrée par `tenant_id`, `active` et date (en plus de la RLS),
 * lue fraîche ; une erreur de lecture rend une liste vide.
 */
export async function getActiveNovelties<T extends NoveltyCandidate = NoveltyCandidate>(
  supabase: SupabaseClient,
  tenantId: string,
  categoryIds: readonly string[],
  now: Date = new Date(),
): Promise<T[]> {
  if (!tenantId || categoryIds.length === 0) return [];
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_CARD_SELECT)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .in('category_id', categoryIds)
    .gt('new_until', now.toISOString())
    .order('created_at', { ascending: false })
    .limit(NOVELTIES_QUERY_LIMIT);
  if (error) {
    console.error('[catalog] Novelties unavailable:', error.message);
    return [];
  }
  return selectActiveNovelties((data ?? []) as unknown as T[], now.getTime());
}
