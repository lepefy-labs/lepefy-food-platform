/**
 * Textes communs du parcours d'achat, en français simple. Un seul endroit
 * pour les libellés répétés entre panier, checkout et messages serveur.
 * Changer un texte ici ne change jamais un montant, un statut ou une règle.
 */

import { formatPrice } from '../utils/format';

export const SUMMARY_COPY = {
  productsPrice: 'Prix des produits',
  shippingPrice: 'Prix de livraison',
  shippingNextStep: "calculée à l'étape suivante",
  shippingAfterAddress: "après l'adresse",
  shippingFree: 'Gratuite',
  totalToPay: 'Total à payer',
  totalPaid: 'Total payé',
  ambassadorAdvantage: 'Avantage ambassadeur',
  taxIncluded: 'TVA incluse',
} as const;

/** « Prix des produits (3) » */
export function productsPriceLabel(itemCount?: number): string {
  return itemCount ? `${SUMMARY_COPY.productsPrice} (${itemCount})` : SUMMARY_COPY.productsPrice;
}

/** Total tant que la livraison n'est pas connue : « 33,70 € + livraison ». */
export function totalWithPendingShipping(subtotal: number, currency = 'EUR'): string {
  return `${formatPrice(subtotal, currency)} + livraison`;
}

export const ACTION_COPY = {
  goToShipping: 'Passer à la livraison',
  choosePayment: 'Choisir le paiement',
  orderAndPay: 'Commander et payer',
  orderPayAtPickup: 'Commander, je paie au retrait',
  processing: 'Un instant…',
  continueShopping: 'Continuer mes achats',
  retry: 'Réessayer',
} as const;

export const ERROR_COPY = {
  generic: "La commande n'a pas pu être créée. Vérifiez votre connexion, puis réessayez.",
  server: 'Le service ne répond pas. Réessayez dans un instant.',
  missingData: 'Il manque des informations. Vérifiez le formulaire.',
  invalidItem: "Un article du panier n'est plus valable. Retournez au panier pour le vérifier.",
  tooManyItems: 'Une quantité est trop grande. Retournez au panier pour la corriger.',
  productsUnavailable: "Certains articles ne sont plus disponibles. Retournez au panier pour les retirer.",
  paymentNeedsCheck: 'Nous devons vérifier ce paiement. Contactez-nous avec votre numéro de commande.',
  sessionNotFound: "Ce paiement n'est plus disponible. Retournez au panier pour recommencer.",
  sessionForbidden: "Ce lien de paiement ne correspond pas à votre compte. Connectez-vous avec le bon e-mail.",
  invalidPaymentMethod: "Ce moyen de paiement n'est plus proposé. Choisissez-en un autre.",
  termsRequired: 'Cochez la case pour accepter les Conditions générales de vente.',
  quantityRulesUnavailable: "Nous n'arrivons pas à vérifier votre panier. Vérifiez votre connexion, puis touchez « Réessayer ».",
  shippingQuoteFailed: "Nous n'arrivons pas à calculer la livraison. Vérifiez votre connexion, puis réessayez.",
  shippingUnavailableNow: "La livraison n'est pas disponible pour le moment. Réessayez plus tard.",
} as const;

export const FORM_COPY = {
  firstNameRequired: 'Écrivez votre prénom.',
  lastNameRequired: 'Écrivez votre nom.',
  emailInvalid: 'Vérifiez votre e-mail. Exemple : nom@gmail.com',
  phoneRequired: "Écrivez votre numéro de téléphone, avec l'indicatif (ex. +33).",
} as const;

/** « Il manque 2 informations. » */
export function missingFieldsTitle(count: number): string {
  return count > 1 ? `Il manque ${count} informations.` : 'Il manque une information.';
}

export const ERROR_SUMMARY_LEAD = 'Complétez les champs en rouge :';
