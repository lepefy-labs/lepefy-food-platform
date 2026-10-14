/**
 * Promotions de la boutique : une seule règle, celle qui existe déjà dans le
 * catalogue. Une promotion est un produit actif dont le prix barré
 * (`compare_at_price`, saisi par le commerçant) dépasse le prix de vente.
 * Aucune date ni remise n'est inventée : le schéma n'en a pas, une promotion
 * « terminée » est un prix barré retiré (ou devenu ≤ prix).
 *
 * Pour être montrée comme promotion (accès « Nos promos », compteur, section),
 * elle doit aussi être achetable : un produit dont le stock ne couvre pas le
 * minimum n'est jamais compté. Les fonctions pures sont partagées avec la
 * vitrine /card (`cardShowcase.ts`).
 */

import { hasPurchasableQuantity } from '../purchaseQuantityRules';
import { PRODUCT_CARD_SELECT } from './productCardSelect';
import type { createClient } from '@/lib/supabase/server';

export interface PromotionPriceFields {
  price: number;
  compare_at_price?: number | null;
}

export interface PromotionCandidate extends PromotionPriceFields {
  id: string;
  stock: number | null;
  min_order_quantity: number;
  order_quantity_step: number;
}

/** Prix barré réel et strictement supérieur au prix de vente. */
export function hasValidPromotion(product: PromotionPriceFields): boolean {
  const compareAt = product.compare_at_price == null ? NaN : Number(product.compare_at_price);
  const price = Number(product.price);
  return Number.isFinite(compareAt) && Number.isFinite(price) && price > 0 && compareAt > price;
}

/** Remise affichée « −14 % », arrondie ; null sans promotion valide. */
export function promotionDiscountPercent(product: PromotionPriceFields): number | null {
  if (!hasValidPromotion(product)) return null;
  const percent = Math.round((1 - Number(product.price) / Number(product.compare_at_price)) * 100);
  return percent > 0 ? percent : null;
}

/** Promotion valide ET achetable (même convention que deriveAvailability : stock inconnu = non limité). */
export function isActivePromotion(product: PromotionCandidate): boolean {
  return hasValidPromotion(product)
    && hasPurchasableQuantity(product.stock ?? 999, product.min_order_quantity || 1, product.order_quantity_step || 1);
}

/**
 * Ne garde que les promotions actives, la plus forte remise d'abord ; à remise
 * égale, l'ordre reçu (position catalogue) est conservé.
 */
export function selectActivePromotions<T extends PromotionCandidate>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.id) || !isActivePromotion(row)) return false;
      seen.add(row.id);
      return true;
    })
    .map((row, index) => ({ row, index, ratio: 1 - Number(row.price) / Number(row.compare_at_price) }))
    .sort((a, b) => b.ratio - a.ratio || a.index - b.index)
    .map(({ row }) => row);
}

/** Plafond de lecture : bien au-delà d'une offre réelle, borne la requête. */
export const PROMOTIONS_QUERY_LIMIT = 200;
/** Cartes affichées dans la section « Nos promos » du catalogue. */
export const PROMOTIONS_SHELF_LIMIT = 10;

type SupabaseClient = ReturnType<typeof createClient>;

/**
 * Promotions actives du tenant, limitées aux catégories boutique reçues.
 * Toujours filtrée par `tenant_id` et `active` (en plus de la RLS) ; prix et
 * stock lus à chaque appel, jamais mis en cache. Une erreur de lecture rend
 * une liste vide : les promotions ne doivent jamais casser le catalogue.
 */
export async function getActivePromotions<T extends PromotionCandidate = PromotionCandidate>(
  supabase: SupabaseClient,
  tenantId: string,
  categoryIds: readonly string[],
): Promise<T[]> {
  if (!tenantId || categoryIds.length === 0) return [];
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_CARD_SELECT)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .in('category_id', categoryIds)
    .not('compare_at_price', 'is', null)
    .order('position')
    .limit(PROMOTIONS_QUERY_LIMIT);
  if (error) {
    console.error('[catalog] Promotions unavailable:', error.message);
    return [];
  }
  return selectActivePromotions((data ?? []) as unknown as T[]);
}
