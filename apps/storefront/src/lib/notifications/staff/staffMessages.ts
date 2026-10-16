import { countryLabel, PRIORITY_LABEL, type StaffPriority } from './orderSignals';

/**
 * Staff notification content, built once from verified data and rendered for
 * each channel (WhatsApp text here, email in operationalEmails.ts). Pure and
 * client-safe: the admin link is a path, resolved against the tenant's
 * canonical storefront URL (tenants.storefront_url) at render time.
 *
 * Never: full address, phone, e-mail, payment details, provider payloads.
 */
export interface StaffAlert {
  kind: string;
  priority: StaffPriority;
  title: string;
  indicators: string[];
  details: Array<[string, string]>;
  action?: string | null;
  link?: { label: string; path: string } | null;
  note?: string | null;
}

export interface ShipmentFacts {
  /** Provider display name, e.g. « Packlink PRO ». */
  provider: string;
  /** Provider shipment reference (Packlink draft/shipment reference). */
  providerReference: string | null;
  /** shipment_custom_reference sent to the provider (LEPEFY-<8>). */
  lepefyReference: string;
  /** Draft provisioning state label, e.g. « Brouillon créé ». */
  draftStatus: string | null;
  carrier: string | null;
  trackingCode: string | null;
  /** Provider-supplied tracking URL only (never built here). */
  trackingUrl: string | null;
  estimatedDelivery: string | null;
}

export interface OrderFacts {
  orderId: string;
  orderNumber: string;
  customer: string | null;
  total: number;
  items: number;
  fulfillment: 'delivery' | 'pickup';
  paymentLabel: string | null;
  /** In-store payment still to collect. */
  paymentPending: boolean;
  destinationCountry: string | null;
  international: boolean | null;
  fresh: boolean;
  frozen: boolean;
  assisted: boolean;
  shipment: ShipmentFacts | null;
}

const MONEY = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Rome' });

export function staffMoney(amount: number): string {
  return MONEY.format(Number.isFinite(amount) ? amount : 0).replace(/[  ]/g, ' ');
}

function dayLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DAY.format(date);
}

function orderPath(orderId: string) {
  return `/admin/orders/${orderId}`;
}

function orderIndicators(order: OrderFacts): string[] {
  const out: string[] = [];
  if (order.international === true) {
    out.push(`🌍 Livraison internationale${countryLabel(order.destinationCountry) ? ` : ${countryLabel(order.destinationCountry)}` : ''}`);
  }
  if (order.fresh) out.push('❄️ Produits frais');
  if (order.frozen) out.push('🧊 Produits surgelés');
  if (order.paymentPending) out.push('💶 Paiement à encaisser en boutique');
  return out;
}

/** Packlink PRO references, so the team finds the parcel in one search. */
export function shipmentDetails(shipment: ShipmentFacts | null): Array<[string, string]> {
  if (!shipment) return [];
  const rows: Array<[string, string]> = [];
  rows.push([shipment.provider, shipment.providerReference ? `réf. ${shipment.providerReference}` : (shipment.draftStatus ?? 'aucune expédition associée')]);
  rows.push(['Réf. Lepefy', shipment.lepefyReference]);
  if (shipment.providerReference && shipment.draftStatus) rows.push(['Brouillon', shipment.draftStatus]);
  if (shipment.trackingCode) rows.push(['Suivi', [shipment.carrier, shipment.trackingCode].filter(Boolean).join(' · ')]);
  const eta = dayLabel(shipment.estimatedDelivery);
  if (eta) rows.push(['Livraison estimée', eta]);
  if (shipment.trackingUrl && /^https:\/\//.test(shipment.trackingUrl)) rows.push(['Suivi transporteur', shipment.trackingUrl]);
  return rows;
}

function orderDetails(order: OrderFacts): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (order.customer) rows.push(['Client', order.customer]);
  rows.push(['Montant', staffMoney(order.total)]);
  rows.push(['Articles', String(order.items)]);
  rows.push(['Mode', order.fulfillment === 'pickup' ? 'Retrait en boutique' : 'Livraison']);
  if (order.paymentLabel) rows.push(['Paiement', order.paymentLabel]);
  if (order.assisted) rows.push(['Origine', 'Commande saisie par l’équipe']);
  return rows;
}

export function orderCreatedAlert(order: OrderFacts, priority: StaffPriority): StaffAlert {
  const coldChain = order.fresh || order.frozen;
  const action = order.fulfillment === 'pickup'
    ? 'Préparer la commande pour le retrait.'
    : coldChain ? 'Préparer la commande en respectant la chaîne du froid.' : 'Préparer la commande.';
  return {
    kind: 'order_created', priority,
    title: `Nouvelle commande ${order.orderNumber}`,
    indicators: orderIndicators(order),
    details: [...orderDetails(order), ...shipmentDetails(order.shipment)],
    action: order.international === true && order.fulfillment === 'delivery'
      ? `${action} Vérifier les conditions d’expédition vers ${countryLabel(order.destinationCountry) ?? 'l’étranger'}.`
      : action,
    link: { label: 'Voir la commande', path: orderPath(order.orderId) },
  };
}

export type RefundState = 'refunded' | 'refund_failed' | 'manual' | 'unknown';

export function orderStockConflictAlert(order: OrderFacts, input: { refund: RefundState }): StaffAlert {
  const refund: Record<RefundState, string> = {
    refunded: 'Client remboursé automatiquement (Stripe).',
    refund_failed: 'Remboursement automatique ÉCHOUÉ : rembourser manuellement.',
    manual: 'Paiement hors Stripe : remboursement manuel à effectuer.',
    unknown: 'Statut du remboursement inconnu : vérifier dans Stripe.',
  };
  return {
    kind: 'order_stock_conflict', priority: 'urgent',
    title: `Conflit de stock · commande ${order.orderNumber}`,
    indicators: ['⚠️ Stock insuffisant après paiement'],
    details: orderDetails(order),
    action: `${refund[input.refund]} Contacter le client.`,
    link: { label: 'Voir la commande', path: orderPath(order.orderId) },
  };
}

export function orderAttentionAlert(order: OrderFacts, issue: string): StaffAlert {
  return {
    kind: 'order_attention_required', priority: 'urgent',
    title: `Commande à vérifier ${order.orderNumber}`,
    indicators: [`⚠️ ${issue}`],
    details: orderDetails(order),
    action: 'Ouvrir la commande et vérifier son contenu avant de la préparer.',
    link: { label: 'Voir la commande', path: orderPath(order.orderId) },
  };
}

export type ShipmentAlertKind = 'shipment_creation_failed' | 'shipment_action_required' | 'shipment_delayed';

export function shipmentAlert(kind: ShipmentAlertKind, order: OrderFacts, issue: string): StaffAlert {
  const title: Record<ShipmentAlertKind, string> = {
    shipment_creation_failed: `Expédition non créée · ${order.orderNumber}`,
    shipment_action_required: `Expédition à vérifier · ${order.orderNumber}`,
    shipment_delayed: `Livraison en retard · ${order.orderNumber}`,
  };
  const action: Record<ShipmentAlertKind, string> = {
    shipment_creation_failed: 'Corriger la cause puis relancer la création depuis la commande, ou créer l’envoi dans Packlink PRO.',
    shipment_action_required: 'Vérifier dans Packlink PRO (recherche par réf. Lepefy) avant toute nouvelle création.',
    shipment_delayed: 'Vérifier le suivi transporteur et prévenir le client si besoin.',
  };
  return {
    kind, priority: kind === 'shipment_delayed' ? 'high' : 'urgent',
    title: title[kind],
    indicators: [`🚚 ${issue}`, ...orderIndicators(order).filter((line) => !line.startsWith('💶'))],
    details: [...(order.customer ? [['Client', order.customer] as [string, string]] : []), ...shipmentDetails(order.shipment)],
    action: action[kind],
    link: { label: 'Voir la commande', path: orderPath(order.orderId) },
  };
}

export function externalPaymentAlert(input: { sessionId: string; reference: string; customer: string | null; amount: number; paymentLabel: string; fulfillment: 'delivery' | 'pickup' }): StaffAlert {
  return {
    kind: 'external_payment_pending', priority: 'high',
    title: `Paiement externe à vérifier ${input.reference}`,
    indicators: ['💳 Paiement déclaré par le client, non confirmé'],
    details: [
      ...(input.customer ? [['Client', input.customer] as [string, string]] : []),
      ['Montant', staffMoney(input.amount)],
      ['Moyen', input.paymentLabel],
      ['Mode', input.fulfillment === 'pickup' ? 'Retrait en boutique' : 'Livraison'],
    ],
    action: 'Vérifier la réception du paiement avant de confirmer. Aucun stock n’est réservé.',
    link: { label: 'Vérifier le paiement', path: `/admin/paiements-en-attente/${input.sessionId}` },
  };
}

export function serviceInquiryAlert(input: { inquiryId: string; serviceTitle: string; customer: string | null; eventDate: string | null; guests: number | null }): StaffAlert {
  return {
    kind: 'service_inquiries', priority: 'normal',
    title: `Demande de devis · ${input.serviceTitle}`,
    indicators: [],
    details: [
      ...(input.customer ? [['Client', input.customer] as [string, string]] : []),
      ...(dayLabel(input.eventDate) ? [['Date', dayLabel(input.eventDate)!] as [string, string]] : []),
      ...(input.guests ? [['Invités', String(input.guests)] as [string, string]] : []),
    ],
    action: 'Répondre au client avec un devis.',
    link: { label: 'Voir les demandes', path: '/admin/evenementiel/devis' },
  };
}

export function rentalReservationAlert(input: { reservationId: string; serviceTitle: string; customer: string | null; deliveryQuotePending: boolean }): StaffAlert {
  return {
    kind: 'rental_reservations', priority: input.deliveryQuotePending ? 'high' : 'normal',
    title: input.deliveryQuotePending ? `Devis de livraison à établir · ${input.serviceTitle}` : `Réservation de matériel · ${input.serviceTitle}`,
    indicators: input.deliveryQuotePending ? ['🚚 Frais de livraison à chiffrer'] : [],
    details: input.customer ? [['Client', input.customer]] : [],
    action: input.deliveryQuotePending ? 'Envoyer le devis de livraison au client.' : 'Préparer le matériel réservé.',
    link: { label: 'Voir les réservations', path: '/admin/evenementiel/reservations-materiel' },
  };
}

export function eventReservationAlert(input: { reservationId: string; eventTitle: string; customer: string | null; seats: number; amount: number; eventDate: string | null }): StaffAlert {
  return {
    kind: 'event_reservation_created', priority: 'normal',
    title: `Nouvelle réservation · ${input.eventTitle}`,
    indicators: [],
    details: [
      ...(input.customer ? [['Client', input.customer] as [string, string]] : []),
      ['Places', String(input.seats)],
      ['Montant', staffMoney(input.amount)],
      ...(dayLabel(input.eventDate) ? [['Date', dayLabel(input.eventDate)!] as [string, string]] : []),
    ],
    link: { label: 'Voir les réservations', path: '/admin/evenementiel/reservations' },
  };
}

export function subscriptionBillingAlert(input: { title: string; text: string; urgent: boolean }): StaffAlert {
  return {
    kind: 'subscription_billing', priority: input.urgent ? 'urgent' : 'high',
    title: input.title,
    indicators: [],
    details: [],
    action: input.text,
    link: { label: 'Voir l’abonnement', path: '/admin/billing' },
  };
}

export interface BacklogOrderLine {
  orderNumber: string;
  customer: string | null;
  total: number;
  priority: StaffPriority;
  international: boolean | null;
  fresh: boolean;
  frozen: boolean;
}

export const SUMMARY_MAX_LINES = 15;

export function backlogSummaryAlert(lines: ReadonlyArray<BacklogOrderLine>, listPath: string): StaffAlert {
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  const urgent = lines.filter((line) => line.priority !== 'normal').length;
  const shown = lines.slice(0, SUMMARY_MAX_LINES).map((line) => {
    const marks = [line.priority !== 'normal' ? '🟠' : '', line.international ? '🌍' : '', line.fresh || line.frozen ? '❄️' : ''].join('');
    return `${marks ? `${marks} ` : ''}${line.orderNumber}${line.customer ? ` · ${line.customer}` : ''} · ${staffMoney(line.total)}`;
  });
  if (lines.length > SUMMARY_MAX_LINES) shown.push(`… et ${lines.length - SUMMARY_MAX_LINES} autres`);
  return {
    kind: 'order_backlog_summary', priority: urgent > 0 ? 'high' : 'normal',
    title: `${lines.length} commande${lines.length > 1 ? 's' : ''} à traiter`,
    indicators: urgent > 0 ? [`🟠 ${urgent} prioritaire${urgent > 1 ? 's' : ''}`] : [],
    details: [['Montant total', staffMoney(total)]],
    note: shown.join('\n'),
    action: 'Récapitulatif des commandes encore ouvertes, sans notification Lepefy enregistrée.',
    link: { label: 'Voir les commandes', path: listPath },
  };
}

export function testAlert(channelLabel: string): StaffAlert {
  return {
    kind: 'test', priority: 'normal',
    title: `Message de test (${channelLabel})`,
    indicators: [],
    details: [],
    action: 'Aucune action requise : ce message confirme que vous recevez les notifications de la boutique.',
    link: { label: 'Paramètres des notifications', path: '/admin/parametres/notifications' },
  };
}

/** Absolute admin URL from the canonical storefront URL; null without one (never a guessed host). */
export function staffAlertUrl(storefrontUrl: string | null | undefined, path: string | null | undefined): string | null {
  if (!path || !storefrontUrl || !/^https:\/\//.test(storefrontUrl)) return null;
  return `${storefrontUrl.replace(/\/$/, '')}${path}`;
}

/** WhatsApp text: short blocks, real states only, one link. */
export function renderStaffWhatsapp(alert: StaffAlert, input: { tenantName: string; storefrontUrl: string | null; test?: boolean }): string {
  const blocks: string[] = [];
  blocks.push(`*Lepefy · ${input.tenantName}*${input.test ? '\n🧪 [TEST] Message de test' : ''}`);
  const head = [`*${alert.title}*`];
  const priority = PRIORITY_LABEL[alert.priority];
  const flags = [...(priority ? [priority] : []), ...alert.indicators];
  blocks.push(head.join('\n'));
  if (flags.length) blocks.push(flags.join('\n'));
  if (alert.details.length) blocks.push(alert.details.map(([label, value]) => `${label} : ${value}`).join('\n'));
  if (alert.note) blocks.push(alert.note);
  if (alert.action) blocks.push(`À faire : ${alert.action}`);
  const url = staffAlertUrl(input.storefrontUrl, alert.link?.path);
  if (url && alert.link) blocks.push(`${alert.link.label} :\n${url}`);
  return blocks.join('\n\n').slice(0, 3900);
}

export function staffEmailSubject(alert: StaffAlert, tenantName: string, test = false): string {
  const prefix = alert.priority === 'urgent' ? '[Urgent] ' : alert.priority === 'high' ? '[Prioritaire] ' : '';
  return `${test ? '[TEST] ' : ''}${prefix}${alert.title} · ${tenantName}`.replace(/[\r\n]+/g, ' ').slice(0, 200);
}
