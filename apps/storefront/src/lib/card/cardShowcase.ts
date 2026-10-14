/**
 * Vitrine « Nos produits en vedette » de /card : choix pur, testé dans
 * tests/unit/cardShowcase.spec.ts. Les lignes viennent de
 * `getCardShowcaseProducts` (déjà filtrées par tenant, produit actif et
 * catégorie boutique) ; ici on ne garde que des produits réellement
 * achetables et on les ordonne de façon déterministe :
 *   1. promotion réelle (`compare_at_price > price`), la plus forte remise
 *      d'abord ;
 *   2. produit mis en avant par le commerçant (`featured`) ;
 *   3. tout autre produit achetable.
 * À rang égal : `position` catalogue puis `id` — jamais d'aléatoire.
 * Aucune date de promotion n'existe dans le schéma : une promotion « expirée »
 * est une promotion dont le commerçant a retiré le prix barré.
 */

import { hasPurchasableQuantity } from '../purchaseQuantityRules';
import { hasValidPromotion } from '../catalog/promotions';

export { hasValidPromotion };

export const CARD_SHOWCASE_LIMIT = 2;

export interface CardShowcaseCandidate {
  id: string;
  price: number;
  compare_at_price?: number | null;
  image_url: string | null;
  stock: number | null;
  min_order_quantity: number;
  order_quantity_step: number;
  featured?: boolean | null;
  position?: number | null;
}

export type CardShowcaseReason = 'promo' | 'featured' | 'available';

/** Achetable = prix positif, photo réelle et stock couvrant au moins le minimum (et son pas). */
export function isShowcaseEligible(product: CardShowcaseCandidate): boolean {
  if (!product.image_url || !(Number(product.price) > 0)) return false;
  // Même convention que deriveAvailability : stock inconnu = non limité.
  return hasPurchasableQuantity(product.stock ?? 999, product.min_order_quantity || 1, product.order_quantity_step || 1);
}

export function showcaseReason(product: CardShowcaseCandidate): CardShowcaseReason {
  if (hasValidPromotion(product)) return 'promo';
  return product.featured ? 'featured' : 'available';
}

const REASON_RANK: Record<CardShowcaseReason, number> = { promo: 0, featured: 1, available: 2 };

function discountRatio(product: CardShowcaseCandidate): number {
  return hasValidPromotion(product) ? 1 - Number(product.price) / Number(product.compare_at_price) : 0;
}

export function selectCardShowcase<T extends CardShowcaseCandidate>(
  candidates: readonly T[],
  limit = CARD_SHOWCASE_LIMIT,
): Array<T & { showcaseReason: CardShowcaseReason }> {
  const unique = new Map<string, T>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.id) && isShowcaseEligible(candidate)) unique.set(candidate.id, candidate);
  }
  return [...unique.values()]
    .map((product) => ({ ...product, showcaseReason: showcaseReason(product) }))
    .sort((a, b) =>
      REASON_RANK[a.showcaseReason] - REASON_RANK[b.showcaseReason]
      || discountRatio(b) - discountRatio(a)
      || (a.position ?? 9999) - (b.position ?? 9999)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, limit));
}
