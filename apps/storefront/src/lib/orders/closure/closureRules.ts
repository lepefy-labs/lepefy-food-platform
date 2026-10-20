/**
 * Order closure rules (migration 161), pure and client-safe: the admin dialog
 * and the server service (orderClosureService) read the same rules. The
 * status stays `cancelled`; `closure_type` tells a commercial cancellation
 * from an order finished directly with the shop. Nothing here touches the
 * payment, refunds or the carrier.
 */

export const CLOSURE_REASONS = ['handled_externally', 'duplicate', 'customer_request', 'product_unavailable', 'other'] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number];

export const CLOSURE_NOTIFICATIONS = ['none', 'standard', 'custom'] as const;
export type ClosureNotification = (typeof CLOSURE_NOTIFICATIONS)[number];

export type ClosureType = 'cancelled' | 'handled_externally';

export const CLOSURE_REASON_LABELS: Record<ClosureReason, string> = {
  handled_externally: 'Commande gérée hors plateforme',
  duplicate: 'Commande en double',
  customer_request: 'Annulation demandée par le client',
  product_unavailable: 'Produit indisponible',
  other: 'Autre motif',
};

export const CLOSURE_REASON_HINTS: Partial<Record<ClosureReason, string>> = {
  handled_externally: 'Le client finalise directement avec la boutique (téléphone, WhatsApp, en magasin). Ce n’est pas une vente perdue.',
  duplicate: 'Une autre commande remplace celle-ci.',
  other: 'Précisez le motif dans la note interne.',
};

export const CLOSURE_NOTIFICATION_LABELS: Record<ClosureNotification, string> = {
  none: 'Ne pas notifier le client',
  standard: 'Envoyer la notification standard',
  custom: 'Envoyer un message personnalisé',
};

export const CLOSURE_TYPE_LABELS: Record<ClosureType, string> = {
  cancelled: 'Annulée',
  handled_externally: 'Traitée hors plateforme',
};

export const CLOSURE_MESSAGE_MIN = 20;
export const CLOSURE_MESSAGE_MAX = 1000;
export const CLOSURE_NOTE_MAX = 500;

export function closureTypeFor(reason: ClosureReason): ClosureType {
  return reason === 'handled_externally' ? 'handled_externally' : 'cancelled';
}

/** Statuses an admin may close: exactly the cancellable transitions of the state machine (adminOrderWorkflow). */
export function isClosableStatus(status: string, fulfillment: 'delivery' | 'pickup'): boolean {
  return status === 'new' || status === 'preparing' || (status === 'ready_for_pickup' && fulfillment === 'pickup');
}

/** Communication choices allowed for a reason and an order. */
export function allowedNotifications(reason: ClosureReason, hasEmail: boolean): ClosureNotification[] {
  if (!hasEmail) return ['none'];
  // « Votre commande a été annulée » would contradict an order finished with the shop.
  return reason === 'handled_externally' ? ['none', 'custom'] : ['none', 'standard', 'custom'];
}

/** Editable starting text of the custom message. */
export function defaultClosureMessage(reason: ClosureReason, input: { firstName: string | null; orderNumber: string; tenantName: string }): string {
  const hello = input.firstName ? `Bonjour ${input.firstName},` : 'Bonjour,';
  if (reason === 'handled_externally') {
    return `${hello} comme convenu, nous finalisons votre commande ${input.orderNumber} directement avec vous. Vous n’avez rien à faire sur le site. Merci et à très vite chez ${input.tenantName} !`;
  }
  if (reason === 'duplicate') {
    return `${hello} votre commande ${input.orderNumber} faisait doublon avec une autre commande : nous l’avons clôturée et nous traitons l’autre. Merci de votre confiance, ${input.tenantName}.`;
  }
  if (reason === 'product_unavailable') {
    return `${hello} nous sommes désolés : un produit de votre commande ${input.orderNumber} n’est plus disponible et nous avons dû l’annuler. Nous restons à votre disposition pour toute question. ${input.tenantName}`;
  }
  if (reason === 'customer_request') {
    return `${hello} comme demandé, votre commande ${input.orderNumber} a bien été annulée. N’hésitez pas à nous contacter pour toute question. ${input.tenantName}`;
  }
  return `${hello} nous revenons vers vous au sujet de votre commande ${input.orderNumber}. ${input.tenantName}`;
}

export interface ShipmentFacts {
  status: string;
  shipping_creation_status?: string | null;
  shipping_provider_reference?: string | null;
  shipping_normalized_status?: string | null;
  tracking_code?: string | null;
}

export interface ClosureGuard {
  /** Closure refused, with the reason to show. */
  blocked: string | null;
  /** A provider shipment exists: the admin must confirm it was handled in the provider. */
  shipmentAck: string | null;
}

const MOVING = new Set(['in_transit', 'out_for_delivery', 'ready_for_collection', 'delivered']);

/** Carrier side: never closes over a parcel already moving or a draft being created. */
export function closureShipmentGuard(order: ShipmentFacts): ClosureGuard {
  if (order.status === 'shipped' || order.status === 'delivered') return { blocked: 'La commande est déjà expédiée ou livrée : elle ne peut plus être clôturée.', shipmentAck: null };
  if (order.shipping_normalized_status && MOVING.has(order.shipping_normalized_status)) {
    return { blocked: 'Le transporteur a déjà pris le colis en charge : traitez d’abord l’expédition dans Packlink PRO.', shipmentAck: null };
  }
  if (order.shipping_creation_status === 'creating' || order.shipping_creation_status === 'ambiguous') {
    return { blocked: 'Un brouillon d’expédition est en cours de création ou à vérifier : vérifiez-le dans Packlink PRO avant de clôturer.', shipmentAck: null };
  }
  if (order.shipping_provider_reference || order.shipping_creation_status === 'draft_created') {
    return { blocked: null, shipmentAck: `Une expédition existe chez le transporteur${order.shipping_provider_reference ? ` (${order.shipping_provider_reference})` : ''}. Lepefy ne la supprime pas : annulez-la dans Packlink PRO si nécessaire.` };
  }
  if (order.tracking_code) return { blocked: null, shipmentAck: `Un code de suivi est enregistré (${order.tracking_code}). Vérifiez qu’aucun colis n’est parti.` };
  return { blocked: null, shipmentAck: null };
}

export interface ClosureInput {
  reason: ClosureReason;
  notification: ClosureNotification;
  message?: string | null;
  note?: string | null;
  shipmentAcknowledged?: boolean;
}

export interface ClosureOrderFacts extends ShipmentFacts {
  fulfillment_type: 'delivery' | 'pickup';
  email: string | null;
}

/** Validation errors in French (empty = valid); the server re-runs it on the fresh order. */
export function closureIssues(order: ClosureOrderFacts, input: ClosureInput): string[] {
  const issues: string[] = [];
  if (!isClosableStatus(order.status, order.fulfillment_type)) issues.push('Cette commande ne peut plus être clôturée.');
  if (!(CLOSURE_REASONS as readonly string[]).includes(input.reason)) issues.push('Choisissez un motif.');
  if (!(CLOSURE_NOTIFICATIONS as readonly string[]).includes(input.notification)) issues.push('Choisissez comment informer le client.');
  else if (!allowedNotifications(input.reason, Boolean(order.email)).includes(input.notification)) {
    issues.push(!order.email ? 'Le client n’a pas d’e-mail : choisissez « Ne pas notifier le client ».' : 'La notification standard « annulée » n’est pas proposée pour une commande gérée hors plateforme.');
  }
  const message = input.message?.trim() ?? '';
  if (input.notification === 'custom' && (message.length < CLOSURE_MESSAGE_MIN || message.length > CLOSURE_MESSAGE_MAX)) {
    issues.push(`Le message doit faire entre ${CLOSURE_MESSAGE_MIN} et ${CLOSURE_MESSAGE_MAX} caractères.`);
  }
  const note = input.note?.trim() ?? '';
  if (note.length > CLOSURE_NOTE_MAX) issues.push(`La note interne est limitée à ${CLOSURE_NOTE_MAX} caractères.`);
  if (input.reason === 'other' && note.length < 3) issues.push('Précisez le motif dans la note interne.');
  const guard = closureShipmentGuard(order);
  if (guard.blocked) issues.push(guard.blocked);
  else if (guard.shipmentAck && !input.shipmentAcknowledged) issues.push('Confirmez que l’expédition a été traitée chez le transporteur.');
  return issues;
}

/** Closure as shown on lists and detail; null for an order that is not closed. */
export function closureOf(order: { status: string; closure_type?: string | null }): ClosureType | null {
  if (order.status !== 'cancelled') return null;
  return order.closure_type === 'handled_externally' ? 'handled_externally' : 'cancelled';
}

export function closureIdempotencyKey(notification: ClosureNotification, orderId: string): string | null {
  // `order-cancelled:` is the historical key of the standard email: a retry never sends it twice.
  if (notification === 'standard') return `order-cancelled:${orderId}`;
  if (notification === 'custom') return `order-closure-message:${orderId}`;
  return null;
}
