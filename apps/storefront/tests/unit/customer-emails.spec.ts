import { expect, test } from '@playwright/test';
import type { TenantNotificationContext } from '../../src/lib/notifications/getTenantNotificationContext';
import {
  orderCancelledEmail,
  orderCompletedEmail,
  orderConfirmedEmail,
  orderReadyForPickupEmail,
  orderShippedEmail,
  paymentReminderEmail,
  eventReservationConfirmedEmail,
  externalPaymentAwaitingVerificationEmail,
  eventExternalPaymentAwaitingVerificationEmail,
  reviewInviteEmail,
  cardQuickPaymentEmail,
  adminInvitedEmail,
} from '../../src/lib/notifications/customerEmails';

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  tenantSlug: 'chloefood',
  tenantName: 'Chloé Food',
  storefrontUrl: 'https://shop.example',
  locale: 'fr-FR',
  currency: 'EUR',
  branding: { logoUrl: 'https://cdn.example/logo.png', primaryColor: '#8a2be2', secondaryColor: '#ffb000', accentColor: '#fff' },
  emailBranding: { fromName: 'Chloé Food', fromEmail: 'noreply@lepefy.com', supportEmail: 'aide@shop.example', whatsappNumber: '+39 333 123 4567' },
  business: { city: 'Milano', country: 'IT', legalAddress: null },
  pickup: { address: 'Via Roma 1, Milano', mapsUrl: 'https://maps.example/x', hours: 'Lun-Ven 9-18\nSam 9-12' },
} satisfies TenantNotificationContext;

const order = { orderNumber: '#ABCD1234', fullName: '<b>Awa</b>', orderTrackingLink: 'https://shop.example/orders/1?token=t' };

test('order confirmation: delivery details, escaped name, support links, tenant branding', () => {
  const email = orderConfirmedEmail(context, {
    ...order, fulfillmentType: 'delivery', total: 79.9, shippingTotal: 8.9,
    shippingAddress: { line1: 'Via <Verdi> 2', postal_code: '20100', city: 'Milano', country: 'IT' },
  });
  expect(email.subject).toBe('✅ Votre commande #ABCD1234 chez Chloé Food est confirmée !');
  expect(email.html).toContain('&lt;b&gt;Awa&lt;/b&gt;');
  expect(email.html).toContain('Via &lt;Verdi&gt; 2<br>20100 Milano<br>IT');
  expect(email.html).toContain('79,90');
  expect(email.html).toContain('https://wa.me/393331234567');
  expect(email.html).toContain('background:#8a2be2');
  expect(email.html).not.toContain('EMAIL DE TEST');
  expect(email.replyTo).toBe('aide@shop.example');
});

test('pickup confirmation shows Click & Collect and no address', () => {
  const email = orderConfirmedEmail(context, { ...order, fulfillmentType: 'pickup', total: 20, shippingTotal: 0, shippingAddress: null });
  expect(email.html).toContain('Click &amp; Collect');
  expect(email.html).not.toContain('Adresse de livraison');
});

test('test mode adds the banner and the [TEST] subject prefix', () => {
  const email = orderCancelledEmail(context, { ...order, testMode: true });
  expect(email.subject).toBe('[TEST] ❌ Votre commande #ABCD1234 a été annulée');
  expect(email.html).toContain('EMAIL DE TEST');
});

test('shipped email shows carrier and tracking code only when provided', () => {
  expect(orderShippedEmail(context, { ...order, trackingCode: 'BRT123', trackingCarrier: 'BRT' }).html).toContain('BRT123');
  expect(orderShippedEmail(context, { ...order, trackingCode: null, trackingCarrier: null }).html).not.toContain('Numéro de suivi');
});

test('ready for pickup: maps CTA first, order details as secondary link, hours on several lines', () => {
  const email = orderReadyForPickupEmail(context, order);
  expect(email.html).toContain('Itinéraire vers la boutique');
  expect(email.html).toContain('Voir les détails de ma commande');
  expect(email.html).toContain('Lun-Ven 9-18<br>Sam 9-12');
  const noMaps = orderReadyForPickupEmail({ ...context, pickup: { ...context.pickup, mapsUrl: null } }, order);
  expect(noMaps.html).toContain('👀 Voir ma commande');
  expect(noMaps.html).not.toContain('Itinéraire');
});

test('completed email wording depends on pickup vs delivery', () => {
  expect(orderCompletedEmail(context, { ...order, completionType: 'picked_up' }).subject).toContain('a bien été retirée');
  const delivered = orderCompletedEmail(context, { ...order, completionType: 'delivered' });
  expect(delivered.subject).toContain('a été livrée');
  expect(delivered.html).toContain('Un problème avec votre livraison ?');
});

test('payment reminder warns not to pay twice once the provider handoff started', () => {
  const base = { paymentReference: '#S1', fullName: 'Awa', paymentMethodLabel: 'PayPal', amount: 42, resumeLink: 'https://shop.example/checkout/reprendre/1?token=x' };
  expect(paymentReminderEmail(context, { ...base, providerHandoffStarted: true }).html).toContain('ne payez pas une seconde fois');
  expect(paymentReminderEmail(context, { ...base, providerHandoffStarted: false }).html).toContain('pas encore finalisé');
});

test('unsafe links are dropped', () => {
  const email = orderCancelledEmail(context, { ...order, orderTrackingLink: 'javascript:alert(1)' });
  expect(email.html).not.toContain('javascript:');
  expect(email.html).not.toContain('class="cta"');
});

test('event reservation confirmation lists tickets and links the ticket and events site', () => {
  const email = eventReservationConfirmedEmail(context, {
    customerName: 'Awa', eventTitle: 'Soirée <jazz>', eventDateStart: '2026-10-10T19:00:00Z', eventLocation: 'Milano',
    amountPaid: 40, items: [{ quantity: 2, label: 'Formule', unitPrice: 20 }], ticketUrl: 'https://events.example/t/abc',
    eventsUrl: 'https://events.example',
  });
  expect(email.subject).toBe('✅ Votre réservation pour Soirée <jazz> est confirmée !');
  expect(email.html).toContain('Soirée &lt;jazz&gt;');
  expect(email.html).toContain('2 × Formule');
  expect(email.html).toContain('Voir mon billet et QR code');
  expect(email.html).toContain('Accéder aux événements');
});

test('external payment alerts warn against confirming unverified payments and reply to the customer', () => {
  const shop = externalPaymentAwaitingVerificationEmail(context, {
    paymentReference: '#S1', paymentMethodLabel: 'PayPal', amount: 50, fulfillmentType: 'pickup',
    customer: { fullName: 'Awa', email: 'awa@example.com', phone: '+39 333 1' }, items: [{ name: 'Riz', price: 25, quantity: 2 }],
    adminPaymentLink: 'https://shop.example/admin/paiements-en-attente/1',
  });
  expect(shop.html).toContain('Ne confirmez pas le paiement');
  expect(shop.html).toContain('tel:+393331');
  expect(shop.html).toContain('Click &amp; Collect');
  expect(shop.replyTo).toBe('awa@example.com');
  const event = eventExternalPaymentAwaitingVerificationEmail(context, {
    event: { title: 'Gala', dateStart: '2026-10-10T19:00:00Z', location: null }, paymentReference: '#R1', paymentMethodLabel: 'Wero',
    amount: 30, quantityTotal: 3, customer: { fullName: null, email: 'b@example.com', phone: null }, items: [],
    adminPaymentLink: null, eventsUrl: null,
  });
  expect(event.subject).toContain('Réservation à vérifier · Gala · #R1');
  expect(event.html).toContain('aucune place n’est réservée');
});

test('review invite wording differs for reminders', () => {
  const base = { orderNumber: '#O1', reviewUrl: 'https://shop.example/avis/donner?token=x', expiresAt: '2026-10-27T00:00:00Z' };
  expect(reviewInviteEmail(context, { ...base, kind: 'initial' }).subject).toBe('Votre avis compte pour Chloé Food');
  const reminder = reviewInviteEmail(context, { ...base, kind: 'reminder' });
  expect(reminder.subject).toContain('Un petit rappel');
  expect(reminder.html).toContain('Donner mon avis');
});

test('card quick payment and admin invitation', () => {
  const card = cardQuickPaymentEmail(context, {
    amount: 12.5, currency: 'eur', customerName: null, customerEmail: null, paidAt: '2026-09-27T10:00:00Z', paymentIntentId: 'pi_123',
  });
  expect(card.subject).toContain('Paiement carte reçu');
  expect(card.html).toContain('Non renseigné');
  expect(card.html).toContain('pi_123');
  const invite = adminInvitedEmail({ tenantName: 'Chloé Food', role: 'tenant_admin', invitedByEmail: 'owner@lepefy.com', loginUrl: 'https://shop.example/admin/login' });
  expect(invite.subject).toBe('Accès administrateur activé — Chloé Food');
  expect(invite.html).toContain('Lepefy Food Platform');
  expect(invite.html).toContain('Se connecter');
});
