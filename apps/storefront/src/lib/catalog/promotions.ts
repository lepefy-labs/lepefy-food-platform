/**
 * Promotions de la boutique : une seule règle, celle du catalogue. Une
 * promotion est un produit actif dont le prix barré (`compare_at_price`)
 * dépasse le prix payé (`price`). Les promotions programmées (migration 156,
 * `promotionSchedule.ts`) écrivent ce même couple pendant leur fenêtre ; leur
 * fin (`promo_ends_at`, « jusqu'à épuisement des stocks ») n'est qu'affichée
 * ici, les transitions sont faites en base. Aucune remise n'est inventée.
 *
 * Pour être montrée comme promotion (accès « Nos promos », compteur, section),
 * elle doit aussi être achetable : un produit dont le stock ne couvre pas le
 * minimum n'est jamais compté. Les fonctions pures sont partagées avec la
 * vitrine /card (`cardShowcase.ts`).
 */

import { hasPurchasableQuantity } from '../purchaseQuantityRules';
import { PRODUCT_CARD_SELECT } from './productCardSelect';
import { formatShopDate } from '../time/shopTime';
import type { createClient } from '@/lib/supabase/server';

export interface PromotionPriceFields {
  price: number;
  compare_at_price?: number | null;
  /** Promotion programmée en cours (migration 156) : sa fin est affichable. */
  promo_applied?: boolean | null;
  promo_ends_at?: string | null;
  promo_until_sold_out?: boolean | null;
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

/** Fin connue d'une promotion programmée en cours (null sinon). */
function runningPromotionEnd(product: PromotionPriceFields): string | null {
  return product.promo_applied && product.promo_ends_at ? product.promo_ends_at : null;
}

/**
 * Promotion valide, pas encore terminée ET achetable (même convention que
 * deriveAvailability : stock inconnu = non limité). Une promotion dont la fin
 * est passée n'est plus comptée, même avant le passage du tick qui la retire.
 */
export function isActivePromotion(product: PromotionCandidate, now: number = Date.now()): boolean {
  const end = runningPromotionEnd(product);
  if (end && Date.parse(end) <= now) return false;
  return hasValidPromotion(product)
    && hasPurchasableQuantity(product.stock ?? 999, product.min_order_quantity || 1, product.order_quantity_step || 1);
}

/**
 * « Jusqu'au ven. 31 oct. », « Jusqu'au ven. 31 oct. ou épuisement des
 * stocks », « Jusqu'à épuisement des stocks » ; null sans fin annoncée.
 * Déterministe (heure de la boutique) : même texte au serveur et au client.
 */
export function promotionEndLabel(product: PromotionPriceFields, style: 'short' | 'long' = 'short'): string | null {
  if (!hasValidPromotion(product) || !product.promo_applied) return null;
  const end = runningPromotionEnd(product);
  const soldOut = Boolean(product.promo_until_sold_out);
  if (end) {
    const date = formatShopDate(end, style);
    return soldOut ? `Jusqu’au ${date} ou épuisement des stocks` : `Jusqu’au ${date}`;
  }
  return soldOut ? 'Jusqu’à épuisement des stocks' : null;
}

/**
 * Ne garde que les promotions actives, la plus forte remise d'abord ; à remise
 * égale, l'ordre reçu (position catalogue) est conservé.
 */
export function selectActivePromotions<T extends PromotionCandidate>(rows: readonly T[], now: number = Date.now()): T[] {
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.id) || !isActivePromotion(row, now)) return false;
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
