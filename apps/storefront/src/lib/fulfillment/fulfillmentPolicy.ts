/**
 * Moteur unique du mode de réception (migration 155), pur et déterministe.
 *
 * Importé par le serveur (`validateCheckoutItems`, donc chaque chemin de
 * paiement) et par le client (panier, checkout) — jamais réimplémenté par
 * appelant. Le client ne fait que guider : seul le serveur décide.
 *
 * Règles panier :
 *   - que des `delivery_or_pickup`            → le client choisit
 *   - au moins un `pickup_only`, aucun `delivery_only` → retrait obligatoire
 *   - au moins un `delivery_only`, aucun `pickup_only` → livraison obligatoire
 *   - `pickup_only` + `delivery_only`         → panier incompatible (bloqué)
 * La capacité de la boutique compte : sans retrait possible, un produit
 * `pickup_only` bloque la commande (on ne fait jamais croire au retrait).
 */

import type { ProductFulfillmentPolicy } from '@lepefy/types';
import { FULFILLMENT_CART_COPY, namesList, type FulfillmentProductRef } from '../storefrontCopy/fulfillmentCopy';

export type FulfillmentMode = 'delivery' | 'pickup';

export const FULFILLMENT_POLICIES: readonly ProductFulfillmentPolicy[] = ['delivery_or_pickup', 'pickup_only', 'delivery_only'];
export const DEFAULT_FULFILLMENT_POLICY: ProductFulfillmentPolicy = 'delivery_or_pickup';

export function isFulfillmentPolicy(value: unknown): value is ProductFulfillmentPolicy {
  return typeof value === 'string' && (FULFILLMENT_POLICIES as readonly string[]).includes(value);
}

export const FULFILLMENT_POLICY_INVALID = 'Mode de réception invalide : choisissez livraison et retrait, retrait uniquement ou livraison uniquement.';

/** Valeur absente (panier enregistré avant la 155) ou inconnue → défaut. */
export function normalizeFulfillmentPolicy(value: unknown): ProductFulfillmentPolicy {
  return isFulfillmentPolicy(value) ? value : DEFAULT_FULFILLMENT_POLICY;
}

export interface FulfillmentProduct extends FulfillmentProductRef {
  fulfillment_policy?: ProductFulfillmentPolicy | string | null;
}

/**
 * `flexible`           aucun produit n'impose de mode
 * `pickup_forced`      un ou plusieurs produits imposent le retrait
 * `delivery_forced`    un ou plusieurs produits imposent la livraison
 * `conflict`           retrait imposé ET livraison imposée : impossible
 * `pickup_unavailable` retrait imposé mais la boutique ne le propose pas
 */
export type CartFulfillmentStatus = 'flexible' | 'pickup_forced' | 'delivery_forced' | 'conflict' | 'pickup_unavailable';

export interface CartFulfillmentEligibility {
  status: CartFulfillmentStatus;
  /** Modes possibles pour cette commande (vide = commande bloquée). */
  allowedModes: FulfillmentMode[];
  /** Le seul mode possible quand il n'en reste qu'un. */
  forcedMode: FulfillmentMode | null;
  blocked: boolean;
  pickupOnlyProducts: FulfillmentProductRef[];
  deliveryOnlyProducts: FulfillmentProductRef[];
}

export function computeCartFulfillment(
  products: ReadonlyArray<FulfillmentProduct>,
  options: { pickupAvailable: boolean },
): CartFulfillmentEligibility {
  const seen = new Set<string>();
  const pickupOnlyProducts: FulfillmentProductRef[] = [];
  const deliveryOnlyProducts: FulfillmentProductRef[] = [];
  for (const product of products) {
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    const policy = normalizeFulfillmentPolicy(product.fulfillment_policy);
    if (policy === 'pickup_only') pickupOnlyProducts.push({ id: product.id, name: product.name });
    if (policy === 'delivery_only') deliveryOnlyProducts.push({ id: product.id, name: product.name });
  }

  const result = (status: CartFulfillmentStatus, allowedModes: FulfillmentMode[]): CartFulfillmentEligibility => ({
    status,
    allowedModes,
    forcedMode: allowedModes.length === 1 ? allowedModes[0]! : null,
    blocked: allowedModes.length === 0,
    pickupOnlyProducts,
    deliveryOnlyProducts,
  });

  if (pickupOnlyProducts.length > 0 && deliveryOnlyProducts.length > 0) return result('conflict', []);
  if (pickupOnlyProducts.length > 0) {
    return options.pickupAvailable ? result('pickup_forced', ['pickup']) : result('pickup_unavailable', []);
  }
  if (deliveryOnlyProducts.length > 0) return result('delivery_forced', ['delivery']);
  return result('flexible', options.pickupAvailable ? ['delivery', 'pickup'] : ['delivery']);
}

export type FulfillmentErrorCode = 'FULFILLMENT_CONFLICT' | 'FULFILLMENT_MODE_NOT_ALLOWED' | 'PICKUP_NOT_ENABLED';

export interface FulfillmentViolation {
  code: FulfillmentErrorCode;
  /** Message client, en français simple. */
  message: string;
  allowedModes: FulfillmentMode[];
  pickupOnlyProducts: FulfillmentProductRef[];
  deliveryOnlyProducts: FulfillmentProductRef[];
}

/** `null` quand le mode choisi est possible pour ce panier. */
export function checkFulfillmentMode(
  eligibility: CartFulfillmentEligibility,
  mode: FulfillmentMode,
): FulfillmentViolation | null {
  if (eligibility.allowedModes.includes(mode)) return null;
  const violation = (code: FulfillmentErrorCode, message: string): FulfillmentViolation => ({
    code,
    message,
    allowedModes: eligibility.allowedModes,
    pickupOnlyProducts: eligibility.pickupOnlyProducts,
    deliveryOnlyProducts: eligibility.deliveryOnlyProducts,
  });

  switch (eligibility.status) {
    case 'conflict':
      return violation('FULFILLMENT_CONFLICT',
        `Votre panier contient des produits incompatibles : à retirer en boutique (${namesList(eligibility.pickupOnlyProducts)}) et en livraison uniquement (${namesList(eligibility.deliveryOnlyProducts)}). ${FULFILLMENT_CART_COPY.conflictAction}`);
    case 'pickup_unavailable':
      return violation('PICKUP_NOT_ENABLED',
        `${FULFILLMENT_CART_COPY.pickupUnavailableTitle} ${FULFILLMENT_CART_COPY.pickupUnavailableDetail(eligibility.pickupOnlyProducts)}`);
    case 'pickup_forced':
      return violation('FULFILLMENT_MODE_NOT_ALLOWED',
        `${FULFILLMENT_CART_COPY.pickupForcedTitle} ${FULFILLMENT_CART_COPY.pickupForcedDetail(eligibility.pickupOnlyProducts)} Choisissez le retrait en boutique.`);
    case 'delivery_forced':
      return violation('FULFILLMENT_MODE_NOT_ALLOWED',
        `${FULFILLMENT_CART_COPY.deliveryForcedTitle} ${FULFILLMENT_CART_COPY.deliveryForcedDetail(eligibility.deliveryOnlyProducts)} Choisissez la livraison.`);
    default:
      // Panier libre : seul le retrait peut manquer (boutique sans retrait).
      return violation('PICKUP_NOT_ENABLED', `${FULFILLMENT_CART_COPY.pickupUnavailableTitle} Choisissez la livraison.`);
  }
}

/**
 * Message bloquant du panier (avant le checkout), ou `null` si le panier peut
 * continuer. Un mode imposé n'est pas un blocage : c'est une information.
 */
export function cartFulfillmentBlockingMessage(eligibility: CartFulfillmentEligibility): string | null {
  if (eligibility.status === 'conflict') return FULFILLMENT_CART_COPY.conflictTitle;
  if (eligibility.status === 'pickup_unavailable') {
    return `${FULFILLMENT_CART_COPY.pickupUnavailableTitle} ${FULFILLMENT_CART_COPY.pickupUnavailableDetail(eligibility.pickupOnlyProducts)}`;
  }
  return null;
}

/** Mode de réception d'un produit du panier, tel que lu par `computeCartFulfillment`. */
export function cartProductPolicy(eligibility: CartFulfillmentEligibility, productId: string): ProductFulfillmentPolicy {
  if (eligibility.pickupOnlyProducts.some((product) => product.id === productId)) return 'pickup_only';
  if (eligibility.deliveryOnlyProducts.some((product) => product.id === productId)) return 'delivery_only';
  return DEFAULT_FULFILLMENT_POLICY;
}
