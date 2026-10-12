/**
 * Textes client du mode de réception (migration 155). Mots simples, sans
 * jargon. Les règles vivent dans `lib/fulfillment/fulfillmentPolicy.ts`.
 */

import type { ProductFulfillmentPolicy } from '@lepefy/types';

export interface FulfillmentProductRef {
  id: string;
  name: string;
}

/** Mention courte d'une card / d'une ligne de panier. */
export const FULFILLMENT_POLICY_LABELS: Record<ProductFulfillmentPolicy, string> = {
  delivery_or_pickup: 'Livraison ou retrait',
  pickup_only: 'Retrait en boutique',
  delivery_only: 'Livraison uniquement',
};

/** Libellés de l'admin (choix du mode de réception). */
export const FULFILLMENT_POLICY_ADMIN_LABELS: Record<ProductFulfillmentPolicy, string> = {
  delivery_or_pickup: 'Livraison et retrait',
  pickup_only: 'Retrait uniquement',
  delivery_only: 'Livraison uniquement',
};

export function namesList(products: ReadonlyArray<FulfillmentProductRef>): string {
  return products.map((product) => product.name).join(', ');
}

/**
 * Mention de la fiche produit, près du bouton d'achat. `null` quand il n'y a
 * rien d'utile à dire (produit standard d'une boutique qui ne fait que livrer).
 */
export function productFulfillmentHint(
  policy: ProductFulfillmentPolicy,
  pickupAvailable: boolean,
): { label: string; detail: string; blocked: boolean } | null {
  if (policy === 'pickup_only') {
    return pickupAvailable
      ? { label: FULFILLMENT_POLICY_LABELS.pickup_only, detail: 'Ce produit est à retirer en boutique. Si vous le prenez, toute la commande sera retirée en boutique.', blocked: false }
      : { label: FULFILLMENT_POLICY_LABELS.pickup_only, detail: 'Ce produit est à retirer en boutique, mais le retrait n’est pas possible en ce moment. Il ne peut pas être commandé.', blocked: true };
  }
  if (policy === 'delivery_only') {
    return { label: FULFILLMENT_POLICY_LABELS.delivery_only, detail: 'Ce produit est disponible seulement en livraison à domicile.', blocked: false };
  }
  return pickupAvailable
    ? { label: FULFILLMENT_POLICY_LABELS.delivery_or_pickup, detail: 'Faites-vous livrer ou venez le chercher en boutique.', blocked: false }
    : null;
}

export const FULFILLMENT_CART_COPY = {
  pickupForcedTitle: 'Cette commande doit être retirée en boutique.',
  pickupForcedDetail: (products: ReadonlyArray<FulfillmentProductRef>) =>
    `Certains produits de votre panier doivent être retirés en boutique : ${namesList(products)}.`,
  deliveryForcedTitle: 'Cette commande ne peut pas être retirée en boutique.',
  deliveryForcedDetail: (products: ReadonlyArray<FulfillmentProductRef>) =>
    `Certains produits sont disponibles uniquement en livraison : ${namesList(products)}.`,
  conflictTitle: 'Votre panier contient des produits incompatibles : certains sont disponibles uniquement en retrait et d’autres uniquement en livraison.',
  conflictPickupList: (products: ReadonlyArray<FulfillmentProductRef>) => `À retirer en boutique : ${namesList(products)}`,
  conflictDeliveryList: (products: ReadonlyArray<FulfillmentProductRef>) => `En livraison uniquement : ${namesList(products)}`,
  conflictAction: 'Retirez l’un des deux groupes de produits pour continuer.',
  pickupUnavailableTitle: 'Le retrait en boutique n’est pas possible en ce moment.',
  pickupUnavailableDetail: (products: ReadonlyArray<FulfillmentProductRef>) =>
    `Retirez ces produits pour continuer : ${namesList(products)}.`,
  checking: 'Vérification du mode de réception…',
  checkFailed: 'Nous n’arrivons pas à vérifier comment recevoir ces produits. Réessayez.',
} as const;
