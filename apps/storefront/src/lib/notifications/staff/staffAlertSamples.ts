import {
  backlogSummaryAlert, eventReservationAlert, externalPaymentAlert, orderAttentionAlert, orderCreatedAlert, orderStockConflictAlert,
  rentalReservationAlert, serviceInquiryAlert, shipmentAlert, subscriptionBillingAlert, testAlert, type OrderFacts, type StaffAlert,
} from './staffMessages';

/**
 * Every staff notification of the dispatcher, built with the production
 * builders on fictitious data (no order, customer or number is read). Shared
 * by the platform « Modèles » page for its email and WhatsApp previews, so a
 * template change shows up in both at once.
 */
export interface StaffAlertSample {
  id: string;
  group: string;
  label: string;
  alert: StaffAlert;
  test?: boolean;
}

const ORDER_ID = 'a82f19c4-0000-4000-8000-000000000000';

function order(partial: Partial<OrderFacts> = {}): OrderFacts {
  return {
    orderId: ORDER_ID, orderNumber: '#A82F19C4', customer: 'Marie K.', total: 86.5, items: 5, fulfillment: 'delivery',
    paymentLabel: 'Carte bancaire', paymentPending: false, destinationCountry: 'IT', international: false, fresh: false, frozen: false, assisted: false,
    shipment: { provider: 'Packlink PRO', providerReference: null, lepefyReference: 'LEPEFY-A82F19C4', draftStatus: 'Création en attente', carrier: null, trackingCode: null, trackingUrl: null, estimatedDelivery: null },
    ...partial,
  };
}

const shipped = {
  provider: 'Packlink PRO', providerReference: 'IT2026PRO0012345', lepefyReference: 'LEPEFY-A82F19C4', draftStatus: 'Brouillon créé',
  carrier: 'BRT', trackingCode: 'BRT0123456789', trackingUrl: 'https://tracking.example/BRT0123456789', estimatedDelivery: '2026-10-14',
};

export function buildStaffAlertSamples(): StaffAlertSample[] {
  const orders = 'Commandes (équipe)';
  const shipping = 'Expéditions (équipe)';
  const other = 'Autres alertes (équipe)';
  return [
    { id: 'staff-order-created', group: orders, label: 'Nouvelle commande · livraison', alert: orderCreatedAlert(order(), 'normal') },
    {
      id: 'staff-order-created-priority', group: orders, label: 'Nouvelle commande · internationale + frais',
      alert: orderCreatedAlert(order({ destinationCountry: 'BE', international: true, fresh: true, shipment: { ...shipped, carrier: null, trackingCode: null, trackingUrl: null, estimatedDelivery: null } }), 'high'),
    },
    {
      id: 'staff-order-created-pickup', group: orders, label: 'Nouvelle commande · retrait, paiement en boutique',
      alert: orderCreatedAlert(order({ fulfillment: 'pickup', paymentLabel: 'À régler en boutique', paymentPending: true, shipment: null, total: 32 }), 'normal'),
    },
    {
      id: 'staff-external-payment', group: orders, label: 'Paiement externe à vérifier',
      alert: externalPaymentAlert({ sessionId: 'c0ffee00-0000-4000-8000-000000000000', reference: '#C0FFEE00', customer: 'Marie K.', amount: 54.9, paymentLabel: 'PayPal', fulfillment: 'delivery' }),
    },
    { id: 'staff-stock-conflict', group: orders, label: 'Conflit de stock · remboursé', alert: orderStockConflictAlert(order(), { refund: 'refunded' }) },
    { id: 'staff-stock-conflict-failed', group: orders, label: 'Conflit de stock · remboursement échoué', alert: orderStockConflictAlert(order(), { refund: 'refund_failed' }) },
    { id: 'staff-attention', group: orders, label: 'Commande à vérifier', alert: orderAttentionAlert(order(), 'Lignes de commande non enregistrées : contenu à vérifier') },
    {
      id: 'staff-backlog-summary', group: orders, label: 'Rattrapage · récapitulatif',
      alert: backlogSummaryAlert([
        { orderNumber: '#A82F19C4', customer: 'Marie K.', total: 86.5, priority: 'high', international: true, fresh: true, frozen: false },
        { orderNumber: '#E5F6A7B8', customer: 'Moussa T.', total: 42, priority: 'normal', international: false, fresh: false, frozen: false },
        { orderNumber: '#C9D0E1F2', customer: null, total: 19.9, priority: 'normal', international: false, fresh: false, frozen: false },
      ], '/admin?status=preparing'),
    },
    { id: 'staff-shipment-failed', group: shipping, label: 'Expédition non créée', alert: shipmentAlert('shipment_creation_failed', order({ shipment: { ...order().shipment!, draftStatus: 'Échec de création' } }), 'Colis non déterminable (dimensions du carton manquantes (Livraison → Emballages)).') },
    { id: 'staff-shipment-action', group: shipping, label: 'Expédition à vérifier', alert: shipmentAlert('shipment_action_required', order({ shipment: shipped }), 'Incident signalé par le transporteur (Adresse incomplète)') },
    { id: 'staff-shipment-delayed', group: shipping, label: 'Livraison en retard', alert: shipmentAlert('shipment_delayed', order({ shipment: shipped }), 'Date de livraison estimée par le transporteur dépassée') },
    {
      id: 'staff-event-reservation', group: other, label: 'Nouvelle réservation d’événement',
      alert: eventReservationAlert({ reservationId: 'e1', eventTitle: 'Soirée afro-gourmande', customer: 'Awa D.', seats: 3, amount: 105, eventDate: '2026-11-07T19:00:00Z' }),
    },
    { id: 'staff-service-inquiry', group: other, label: 'Demande de devis', alert: serviceInquiryAlert({ inquiryId: 's1', serviceTitle: 'Traiteur mariage', customer: 'Awa D.', eventDate: '2026-12-12', guests: 80 }) },
    { id: 'staff-rental', group: other, label: 'Réservation matériel · devis de livraison', alert: rentalReservationAlert({ reservationId: 'r1', serviceTitle: 'Location tables & chaises', customer: 'Awa D.', deliveryQuotePending: true }) },
    { id: 'staff-subscription', group: other, label: 'Abonnement Lepefy · rappel', alert: subscriptionBillingAlert({ title: 'Abonnement Lepefy : suspension dans 7 jours (15 octobre 2026)', text: 'Régler l’abonnement pour éviter la suspension de la boutique.', urgent: false }) },
    { id: 'staff-test', group: other, label: 'Message de test', alert: testAlert('WhatsApp'), test: true },
  ];
}
