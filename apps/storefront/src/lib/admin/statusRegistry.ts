import type { AdminTone } from './tokens';
import { CARD_CART_OUTCOME_META } from '@/lib/payments/cardCartOutcome';

/**
 * Domain state → label + semantic tone, shared by every admin badge so the same
 * state always looks the same. Add a domain here instead of mapping colours in
 * a page. Tones mean: info = new / in flow, warning = needs work, urgent =
 * time-critical, danger = failure or blocked, success = done, neutral = inert.
 */
export interface AdminStatusMeta { label: string; tone: AdminTone }

export const ORDER_STATUS_META: Record<string, AdminStatusMeta> = {
  new: { label: 'Nouveau', tone: 'info' },
  preparing: { label: 'En préparation', tone: 'warning' },
  ready_for_pickup: { label: 'Prêt à retirer', tone: 'success' },
  shipped: { label: 'Expédié', tone: 'info' },
  delivered: { label: 'Livré', tone: 'success' },
  cancelled: { label: 'Annulé', tone: 'neutral' },
  stock_conflict: { label: 'Conflit de stock', tone: 'danger' },
};

export const ORDER_STATUS_LABELS_IT: Record<string, string> = {
  new: 'Nuovo',
  preparing: 'In preparazione',
  ready_for_pickup: 'Pronto per ritiro',
  shipped: 'Spedito',
  delivered: 'Consegnato',
  cancelled: 'Annullato',
  stock_conflict: 'Conflitto di stock',
};

/** Preparation step of a new / preparing order (lib/orders/preparation/preparationPolicy.ts). */
export const PREPARATION_STEP_META: Record<string, AdminStatusMeta> = {
  to_print: { label: 'À imprimer', tone: 'info' },
  to_prepare: { label: 'À préparer', tone: 'info' },
  printed: { label: 'Liste imprimée', tone: 'neutral' },
  in_progress: { label: 'Préparation en cours', tone: 'warning' },
  prepared: { label: 'Préparation terminée', tone: 'success' },
  // Orange: the team still has something to do in Lepefy (green = nothing left).
  parcels_to_enter: { label: 'Colis à indiquer', tone: 'warning' },
  ready: { label: 'Prêt à expédier', tone: 'success' },
};

export const PAYMENT_STATUS_META: Record<string, AdminStatusMeta> = {
  paid: { label: 'Payé', tone: 'success' },
  pending: { label: 'En attente', tone: 'warning' },
  failed: { label: 'Échoué', tone: 'danger' },
  refunded: { label: 'Remboursé', tone: 'neutral' },
  cancelled: { label: 'Annulé', tone: 'neutral' },
};

/** Journal d'activité: outcome of an event (docs/ADMIN_ACTIVITY_AUDIT.md). */
export const AUDIT_OUTCOME_META: Record<string, AdminStatusMeta> = {
  success: { label: 'Réussi', tone: 'success' },
  failure: { label: 'Échec', tone: 'danger' },
  pending: { label: 'En attente', tone: 'info' },
  unknown: { label: 'À vérifier', tone: 'warning' },
};

/** Journal d'activité: severity of an event. */
export const AUDIT_SEVERITY_META: Record<string, AdminStatusMeta> = {
  info: { label: 'Info', tone: 'neutral' },
  notice: { label: 'À noter', tone: 'info' },
  warning: { label: 'Attention', tone: 'warning' },
  critical: { label: 'Critique', tone: 'urgent' },
};

/** Supplément de livraison d'une location de matériel (rental_reservations.delivery_fee_status). */
export const RENTAL_DELIVERY_FEE_STATUS_META: Record<string, AdminStatusMeta> = {
  not_applicable: { label: 'Sans livraison', tone: 'neutral' },
  pending_quote: { label: 'À évaluer', tone: 'warning' },
  quoted: { label: 'En attente du paiement', tone: 'info' },
  paid: { label: 'Payé', tone: 'success' },
};

/** Catalogue : promotion d'un produit (lib/catalog/promotionSchedule.ts, migration 156). */
export const PRODUCT_PROMOTION_META: Record<string, AdminStatusMeta> = {
  none: { label: 'Sans promotion', tone: 'neutral' },
  manual: { label: 'Promo sans date', tone: 'success' },
  scheduled: { label: 'Promo programmée', tone: 'info' },
  active: { label: 'En promo', tone: 'success' },
};

/** Catalogue : nouveauté d'un produit (lib/catalog/novelties.ts, migration 156). */
export const PRODUCT_NOVELTY_META: Record<string, AdminStatusMeta> = {
  active: { label: 'Nouveauté', tone: 'info' },
  none: { label: 'Pas une nouveauté', tone: 'neutral' },
};

export const CATALOG_CAMPAIGN_STATUS_META: Record<string, AdminStatusMeta> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  scheduled: { label: 'Programmée', tone: 'info' },
  running: { label: 'En cours', tone: 'success' },
  suspended: { label: 'Suspendue', tone: 'warning' },
  ended: { label: 'Terminée', tone: 'neutral' },
};

/** Panier carte non finalisé : ce que montrent le journal et Stripe (lib/payments/cardCartOutcome.ts). */
export const CARD_CART_STATUS_META: Record<string, AdminStatusMeta> = Object.fromEntries(
  Object.entries(CARD_CART_OUTCOME_META).map(([key, meta]) => [key, { label: meta.label, tone: meta.tone }]),
);

export function statusMeta(registry: Record<string, AdminStatusMeta>, status: string | null | undefined): AdminStatusMeta {
  if (!status) return { label: '—', tone: 'neutral' };
  return registry[status] ?? { label: status, tone: 'neutral' };
}

/** Notification delivery ledger (migrations 136/158), platform console. */
export const NOTIFICATION_DELIVERY_STATUS_META: Record<string, AdminStatusMeta> = {
  pending: { label: 'En file', tone: 'info' },
  processing: { label: 'Envoi en cours', tone: 'info' },
  accepted: { label: 'Accepté', tone: 'success' },
  delivered: { label: 'Délivré', tone: 'success' },
  failed: { label: 'Nouvel essai prévu', tone: 'warning' },
  dead: { label: 'Échec définitif', tone: 'danger' },
  skipped: { label: 'Non envoyé', tone: 'neutral' },
  unknown: { label: 'Résultat incertain', tone: 'urgent' },
};

/** Catch-up classification of an open order (notification state, not the order state). */
export const NOTIFICATION_BACKFILL_STATE_META: Record<string, AdminStatusMeta> = {
  not_notified: { label: 'Aucune notification Lepefy enregistrée', tone: 'warning' },
  failed: { label: 'Notification en échec', tone: 'danger' },
  pending: { label: 'Notification en cours', tone: 'info' },
  partial: { label: 'Notifiée en partie', tone: 'warning' },
  notified: { label: 'Déjà notifiée', tone: 'success' },
  no_target: { label: 'Aucun destinataire', tone: 'neutral' },
};
