import type { TenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import {
  adminInvitedEmail, cardQuickPaymentCustomerEmail, cardQuickPaymentEmail, eventBookingClosedReportsEmail, eventExternalPaymentAwaitingVerificationEmail,
  eventReservationConfirmedEmail, externalPaymentAwaitingVerificationEmail, orderCancelledEmail, orderCompletedEmail,
  orderConfirmedEmail, orderReadyForPickupEmail, orderShippedEmail, paymentReminderEmail, reviewInviteEmail,
} from '@/lib/notifications/customerEmails';
import {
  eventCapacityConflictEmail, marketingCampaignEmail, rentalDeliveryQuotePendingEmail, rentalReservationAdminEmail,
  rentalReservationCustomerEmail, rentalStockConflictEmail, serviceInquiryEmail,
} from '@/lib/notifications/operationalEmails';
import { buildOrderStockConflictNotification } from '@/lib/notifications/orderStockConflictEmail';
import { buildTesterFeedbackInviteEmail } from '@/lib/notifications/testerFeedbackInviteEmail';
import { renderDigestHtml, type DigestItem } from '@/lib/notifications/dailyOrderDigest';

export interface TemplatePreview {
  id: string;
  group: string;
  label: string;
  /** Who receives it in production. */
  audience: 'Client' | 'Équipe du tenant' | 'Plateforme';
  subject: string;
  html: string;
}

/**
 * Every email the platform sends, rendered with the production builders, the
 * tenant branding and fictitious data (no order, customer or token is read or
 * created). Used by Admin → Plateforme → Notifications → Modèles.
 */
export function buildTemplatePreviews(context: TenantNotificationContext, now = new Date()): TemplatePreview[] {
  const base = context.storefrontUrl ? context.storefrontUrl.replace(/\/$/, '') : 'https://boutique.example';
  const inDays = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
  const order = { orderNumber: '#A1B2C3D4', fullName: 'Awa Diallo', orderTrackingLink: `${base}/orders/exemple?token=apercu` };
  const address = { line1: 'Via Roma 12', postal_code: '20121', city: 'Milano', country: 'IT' };
  const customer = { fullName: 'Awa Diallo', email: 'awa.diallo@example.com', phone: '+39 333 123 4567' };
  const rental = {
    reservationId: 'r1b2c3d4-0000-4000-8000-000000000000', serviceTitle: 'Location tables & chaises', customerName: 'Awa Diallo',
    customerEmail: customer.email, customerPhone: customer.phone, pickupDate: inDays(10).slice(0, 10), amountPaid: 180,
    items: [{ name: 'Table ronde', quantity: 4 }, { name: 'Chaise pliante', quantity: 24 }],
    fulfillmentType: 'delivery', deliveryFeeStatus: 'pending_quote',
  };
  const digestItems: DigestItem[] = [
    { key: 'o1', priority: 'urgent', reference: '#A1B2C3D4', customer: 'Awa Diallo', reason: 'Payée il y a 30 h, toujours en préparation', action: 'Préparer et expédier', url: `${base}/admin/orders/exemple`, createdAt: inDays(-1.3) },
    { key: 'o2', priority: 'today', reference: '#E5F6A7B8', customer: 'Moussa Traoré', reason: 'Nouvelle commande payée', action: 'Préparer la commande', url: `${base}/admin/orders/exemple`, createdAt: inDays(-0.2) },
    { key: 'o3', priority: 'monitor', reference: '#C9D0E1F2', customer: 'Fatou Ndiaye', reason: 'Prête au retrait depuis 20 h', action: 'Relancer le client si besoin', url: `${base}/admin/orders/exemple`, createdAt: inDays(-0.8) },
  ];
  const digestDate = now.toISOString().slice(0, 10);

  const previews: TemplatePreview[] = [];
  const add = (id: string, group: string, label: string, audience: TemplatePreview['audience'], email: { subject: string; html: string }) =>
    previews.push({ id, group, label, audience, subject: email.subject, html: email.html });

  // Commandes
  add('order-confirmed-delivery', 'Commandes', 'Commande confirmée · livraison', 'Client',
    orderConfirmedEmail(context, { ...order, fulfillmentType: 'delivery', total: 79.9, shippingTotal: 8.9, shippingAddress: address }));
  add('order-confirmed-pickup', 'Commandes', 'Commande confirmée · retrait', 'Client',
    orderConfirmedEmail(context, { ...order, fulfillmentType: 'pickup', total: 42.5, shippingTotal: 0, shippingAddress: null }));
  add('order-shipped', 'Commandes', 'Commande expédiée', 'Client',
    orderShippedEmail(context, {
      ...order, trackingCode: 'BRT0012345678', trackingCarrier: 'BRT', shippingEstimatedDeliveryAt: '2026-10-06T00:00:00.000Z',
    }));
  add('order-ready-for-pickup', 'Commandes', 'Prête au retrait', 'Client', orderReadyForPickupEmail(context, order));
  add('order-completed-delivered', 'Commandes', 'Commande livrée', 'Client', orderCompletedEmail(context, { ...order, completionType: 'delivered' }));
  add('order-completed-picked-up', 'Commandes', 'Commande retirée', 'Client', orderCompletedEmail(context, { ...order, completionType: 'picked_up' }));
  add('order-cancelled', 'Commandes', 'Commande annulée', 'Client', orderCancelledEmail(context, order));
  add('order-stock-conflict', 'Commandes', 'Conflit de stock après paiement', 'Équipe du tenant',
    buildOrderStockConflictNotification(context, ['equipe@example.com'], {
      orderId: 'exemple', orderNumber: order.orderNumber, email: customer.email, fullName: customer.fullName, fulfillmentType: 'delivery',
      total: 79.9, reason: 'insufficient_stock', refundSucceeded: true, manualRefundRequired: false, adminOrderLink: `${base}/admin/orders/exemple`,
    }));

  // Paiements
  const reminder = { paymentReference: '#S1T2U3V4', fullName: customer.fullName, paymentMethodLabel: 'PayPal', amount: 64.9, resumeLink: `${base}/checkout/reprendre/exemple?token=apercu` };
  add('payment-reminder-started', 'Paiements', 'Relance paiement · paiement peut-être déjà fait', 'Client', paymentReminderEmail(context, { ...reminder, providerHandoffStarted: true }));
  add('payment-reminder-open', 'Paiements', 'Relance paiement · achat non finalisé', 'Client', paymentReminderEmail(context, { ...reminder, providerHandoffStarted: false }));
  add('external-payment', 'Paiements', 'Paiement externe à vérifier', 'Équipe du tenant', externalPaymentAwaitingVerificationEmail(context, {
    paymentReference: '#S1T2U3V4', paymentMethodLabel: 'PayPal', amount: 64.9, fulfillmentType: 'delivery', customer,
    items: [{ name: 'Attiéké 1 kg', price: 6.5, quantity: 4 }, { name: 'Huile de palme 1 L', price: 9.9, quantity: 2 }],
    adminPaymentLink: `${base}/admin/paiements-en-attente/exemple`,
  }));
  add('card-quick-payment', 'Paiements', 'Paiement carte reçu', 'Équipe du tenant', cardQuickPaymentEmail(context, {
    amount: 35, currency: context.currency || 'EUR', customerName: customer.fullName, customerEmail: customer.email, paidAt: now.toISOString(), paymentIntentId: 'pi_exemple',
  }));
  // Real tenant configuration (shop options, Android state), then each app state.
  const cardPayment = { quickPaymentId: 'a82f31c4-0000-4000-8000-000000000000', amount: 38, currency: context.currency || 'EUR', customerName: customer.fullName, paidAt: now.toISOString() };
  add('card-quick-payment-customer', 'Paiements', 'Paiement carte confirmé · client', 'Client', cardQuickPaymentCustomerEmail(context, cardPayment));
  add('card-quick-payment-customer-app-soon', 'Paiements', 'Paiement carte confirmé · app Android bientôt', 'Client', cardQuickPaymentCustomerEmail(
    { ...context, mobileApp: { android: { status: 'coming_soon', playStoreUrl: null } } }, { ...cardPayment, customerName: null },
  ));
  add('card-quick-payment-customer-app-live', 'Paiements', 'Paiement carte confirmé · app Android publiée', 'Client', cardQuickPaymentCustomerEmail(
    { ...context, mobileApp: { android: { status: 'available', playStoreUrl: 'https://play.google.com/store/apps/details?id=com.example.boutique' } } }, cardPayment,
  ));

  // Événements
  const event = { title: 'Soirée afro-jazz', dateStart: inDays(14), location: 'Milano' };
  add('event-reservation-confirmed', 'Événements', 'Réservation confirmée', 'Client', eventReservationConfirmedEmail(context, {
    customerName: customer.fullName, eventTitle: event.title, eventDateStart: event.dateStart, eventLocation: event.location, amountPaid: 70,
    items: [{ quantity: 2, label: 'Entrée + repas', unitPrice: 35 }], ticketUrl: `${base}/billet/exemple`, eventsUrl: base,
  }));
  add('event-external-payment', 'Événements', 'Réservation à vérifier', 'Équipe du tenant', eventExternalPaymentAwaitingVerificationEmail(context, {
    event, paymentReference: '#R1S2T3U4', paymentMethodLabel: 'Wero', amount: 70, quantityTotal: 2, customer,
    items: [{ name: 'Entrée + repas', price: 35, quantity: 2 }], adminPaymentLink: `${base}/admin/evenementiel/paiements-en-attente/exemple`, eventsUrl: base,
  }));
  add('event-capacity-conflict', 'Événements', 'Événement complet après paiement', 'Équipe du tenant', eventCapacityConflictEmail(context, {
    eventTitle: event.title, eventDateStart: event.dateStart, customerName: customer.fullName, customerEmail: customer.email, refundSucceeded: true, manualRefundRequired: false,
  }));
  add('event-closing-reports', 'Événements', 'Rapports de clôture (avec pièces jointes)', 'Équipe du tenant', eventBookingClosedReportsEmail(context, {
    eventTitle: event.title, eventDateStart: event.dateStart, reservations: 38, people: 96,
  }));

  // Location & services
  add('service-inquiry', 'Location & services', 'Nouvelle demande de devis', 'Équipe du tenant', serviceInquiryEmail(context, {
    serviceTitle: 'Traiteur mariage', customerName: customer.fullName, customerEmail: customer.email, customerPhone: customer.phone,
    dateSouhaitee: inDays(60).slice(0, 10), nombreInvites: 120, message: 'Bonjour, nous souhaitons un buffet sénégalais pour 120 personnes.',
  }));
  add('rental-customer', 'Location & services', 'Réservation de matériel · client', 'Client', rentalReservationCustomerEmail(context, rental));
  add('rental-admin', 'Location & services', 'Réservation de matériel · équipe', 'Équipe du tenant', rentalReservationAdminEmail(context, rental));
  add('rental-delivery-quote', 'Location & services', 'Frais de livraison à chiffrer', 'Équipe du tenant', rentalDeliveryQuotePendingEmail(context, {
    reservationId: rental.reservationId, customerName: customer.fullName, customerEmail: customer.email, customerPhone: customer.phone,
    address: { street: 'Via Roma', houseNumber: '12', postalCode: '20121', city: 'Milano', country: 'IT' },
  }));
  add('rental-stock-conflict', 'Location & services', 'Matériel indisponible après paiement', 'Équipe du tenant', rentalStockConflictEmail(context, {
    serviceTitle: rental.serviceTitle, customerName: customer.fullName, customerEmail: customer.email, refundSucceeded: false, manualRefundRequired: false,
  }));

  // Avis & invitations
  const review = { orderNumber: order.orderNumber, reviewUrl: `${base}/avis/donner?token=apercu`, expiresAt: inDays(30) };
  add('review-invite', 'Avis & invitations', 'Invitation à donner un avis', 'Client', reviewInviteEmail(context, { ...review, kind: 'initial' }));
  add('review-reminder', 'Avis & invitations', 'Rappel d’avis', 'Client', reviewInviteEmail(context, { ...review, kind: 'reminder' }));
  add('tester-invite', 'Avis & invitations', 'Invitation testeur (application)', 'Plateforme', buildTesterFeedbackInviteEmail(
    context.tenantName, context.branding?.logoUrl ?? null, 'https://play.google.com/apps/testing/exemple', `${base}/feedback/invite/apercu`,
  ));
  add('admin-invited', 'Avis & invitations', 'Invitation administrateur', 'Plateforme', adminInvitedEmail({
    tenantName: context.tenantName, role: 'tenant_admin', invitedByEmail: 'support@lepefy.com', loginUrl: `${base}/admin/login`,
  }));

  // Opérations & marketing
  add('daily-digest', 'Opérations & marketing', 'Rapport quotidien (08h)', 'Équipe du tenant', {
    subject: `[Rapport du matin] 1 urgentes · 1 à traiter · ${context.tenantName}`,
    html: renderDigestHtml(context.tenantName, digestDate, digestItems, ['o3'], `${base}/admin`, context.branding?.logoUrl ?? null),
  });
  add('marketing-campaign', 'Opérations & marketing', 'Campagne marketing', 'Client', marketingCampaignEmail(context, {
    subject: 'Nouveautés de la semaine', campaignName: 'Octobre',
    content: `Bonjour,\n\nDécouvrez nos nouveaux produits de la semaine et profitez de la livraison offerte dès 60 €.\n\nÀ très vite chez ${context.tenantName} !`,
  }));
  return previews;
}
