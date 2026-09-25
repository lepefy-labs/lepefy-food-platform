// Commandes assistées (migration 128) : achats reçus par WhatsApp, téléphone,
// Instagram ou en magasin, saisis par l'équipe. Tant que le paiement n'est pas
// confirmé, l'achat vit dans une checkout_session `origin = 'assisted'`
// (« précommande ») ; seule la conversion crée la commande.

/** Canal par lequel l'achat a été reçu. */
export type SalesChannel = 'whatsapp' | 'phone' | 'instagram' | 'in_store' | 'other';

export const SALES_CHANNEL_LABELS: Record<SalesChannel, string> = {
  whatsapp: 'WhatsApp',
  phone: 'Téléphone',
  instagram: 'Instagram',
  in_store: 'En magasin',
  other: 'Autre',
};

/** Statut technique d'une checkout_session (lifecycle existant + `draft`). */
export type CheckoutSessionStatus = 'draft' | 'open' | 'awaiting_verification' | 'completed' | 'cancelled' | 'expired';

/** Statuts fonctionnels affichés pour une précommande, mappés 1:1 sur `CheckoutSessionStatus`. */
export const PREORDER_STATUS_LABELS: Record<CheckoutSessionStatus, string> = {
  draft: 'Brouillon',
  open: 'En attente de paiement',
  awaiting_verification: 'Paiement à vérifier',
  completed: 'Terminée',
  expired: 'Expirée',
  cancelled: 'Annulée',
};

/**
 * Moyens d'encaissement hors Stripe qu'un opérateur peut enregistrer ou
 * vérifier. Stocké dans `external_payment_type` (session et commande).
 */
export type ManualPaymentMethod = 'cash' | 'bank_transfer' | 'postepay' | 'satispay' | 'paypal' | 'revolut' | 'other';

export const MANUAL_PAYMENT_METHOD_LABELS: Record<ManualPaymentMethod, string> = {
  cash: 'Espèces',
  bank_transfer: 'Virement bancaire',
  postepay: 'Postepay',
  satispay: 'Satispay',
  paypal: 'PayPal',
  revolut: 'Revolut',
  other: 'Autre',
};

/** Parcours choisi à la fin de la saisie. */
export type AssistedOrderMode = 'draft' | 'to_pay' | 'to_verify' | 'paid';

export type AssistedOrderEventType =
  | 'created' | 'updated' | 'link_issued' | 'link_revoked' | 'link_opened'
  | 'payment_declared' | 'payment_confirmed' | 'order_created' | 'reopened'
  | 'cancelled' | 'expired' | 'stock_conflict' | 'duplicate_payment' | 'amount_mismatch'
  | 'notification_sent' | 'notification_skipped';

export interface AssistedOrderEvent {
  id: string;
  event_type: AssistedOrderEventType;
  actor_type: 'admin' | 'customer' | 'system';
  actor_admin_id: string | null;
  order_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface AssistedCartLine {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
}

/** Adresse de livraison saisie par l'opérateur (même forme que le checkout). */
export interface AssistedShippingAddress {
  full_name: string;
  line1: string;
  line2?: string | null;
  city: string;
  postal_code: string;
  country: string;
}
