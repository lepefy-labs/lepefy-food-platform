import { expect, test } from '@playwright/test';
import type { TenantNotificationContext } from '../../src/lib/notifications/getTenantNotificationContext';
import {
  orderCancelledEmail,
  orderCompletedEmail,
  orderConfirmedEmail,
  orderReadyForPickupEmail,
  orderShippedEmail,
  paymentReminderEmail,
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
