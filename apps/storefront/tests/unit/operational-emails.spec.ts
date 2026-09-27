import { expect, test } from '@playwright/test';
import type { TenantNotificationContext } from '../../src/lib/notifications/getTenantNotificationContext';
import { deliverEmail, SEND_EMAIL_WEBHOOK } from '../../src/lib/notifications/sendEmail';
import {
  eventCapacityConflictEmail,
  marketingCampaignEmail,
  rentalDeliveryQuotePendingEmail,
  rentalReservationCustomerEmail,
  serviceInquiryEmail,
} from '../../src/lib/notifications/operationalEmails';

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  tenantSlug: 'chloefood',
  tenantName: 'Chloé <Food>',
  storefrontUrl: 'https://shop.example',
  locale: 'fr-FR',
  currency: 'EUR',
  branding: { logoUrl: 'javascript:alert(1)', primaryColor: '#8a2be2', secondaryColor: '#000', accentColor: '#fff' },
  emailBranding: { fromName: 'Chloé', fromEmail: 'noreply@lepefy.com', supportEmail: 'aide@shop.example', whatsappNumber: null },
  business: { city: null, country: 'IT', legalAddress: null },
  pickup: { address: null, mapsUrl: null, hours: null },
} satisfies TenantNotificationContext;

test('customer-controlled values are escaped and unsafe links dropped', () => {
  const email = serviceInquiryEmail(context, {
    serviceTitle: 'Traiteur', customerName: '<script>x</script>', customerEmail: 'a@b.it',
    customerPhone: null, dateSouhaitee: null, nombreInvites: 40, message: '<img src=x onerror=1>',
  });
  expect(email.html).not.toContain('<script>');
  expect(email.html).not.toContain('<img src=x');
  expect(email.html).toContain('&lt;script&gt;');
  expect(email.html).not.toContain('javascript:');
  expect(email.html).toContain('Chloé &lt;Food&gt;');
  expect(email.replyTo).toBe('a@b.it');
});

test('refund state drives the conflict callout', () => {
  const failed = eventCapacityConflictEmail(context, {
    eventTitle: 'Soirée', eventDateStart: '2026-10-10T19:00:00Z', customerName: 'Awa', customerEmail: 'a@b.it',
    refundSucceeded: false, manualRefundRequired: false,
  });
  expect(failed.html).toContain('a ÉCHOUÉ');
  expect(failed.subject).toContain('[Action requise]');
});

test('rental customer confirmation mentions a pending delivery quote', () => {
  const email = rentalReservationCustomerEmail(context, {
    reservationId: 'abcdef12-0000-4000-8000-000000000000', serviceTitle: 'Tables', customerName: 'Awa',
    customerEmail: 'a@b.it', customerPhone: null, pickupDate: '2026-10-10', amountPaid: 120,
    items: [{ name: 'Table ronde', quantity: 4 }], fulfillmentType: 'delivery', deliveryFeeStatus: 'pending_quote',
  });
  expect(email.html).toContain('4 × Table ronde');
  expect(email.html).toContain('frais de livraison');
  expect(email.html).toContain('ABCDEF12');
  expect(email.replyTo).toBe('aide@shop.example');
});

test('delivery quote alert formats the address', () => {
  const email = rentalDeliveryQuotePendingEmail(context, {
    reservationId: 'abcdef12-0000-4000-8000-000000000000', customerName: 'Awa', customerEmail: 'a@b.it',
    customerPhone: '+39 1', address: { street: 'Via Roma', houseNumber: '3', postalCode: '20100', city: 'Milano', country: 'IT' },
  });
  expect(email.html).toContain('Via Roma 3, 20100 Milano, IT');
});

test('marketing email keeps paragraphs, escapes content and offers a manual opt-out', () => {
  const email = marketingCampaignEmail(context, { subject: 'Nouveautés', content: 'Bonjour\n\n<b>Promo</b>\nligne 2', campaignName: 'Octobre' });
  expect(email.subject).toBe('Nouveautés');
  expect(email.html).toContain('&lt;b&gt;Promo&lt;/b&gt;<br>ligne 2');
  expect(email.html).toContain('Pour ne plus les recevoir');
  expect(email.replyTo).toBe('aide@shop.example');
});

test('deliverEmail posts the rendered email to the generic webhook and skips empty recipient lists', async () => {
  const calls: Array<{ path: string; payload: Record<string, unknown> }> = [];
  const notify = async (path: string, payload: Record<string, unknown>) => { calls.push({ path, payload }); return true; };
  const email = serviceInquiryEmail(context, {
    serviceTitle: 'Traiteur', customerName: 'Awa', customerEmail: 'a@b.it',
    customerPhone: null, dateSouhaitee: null, nombreInvites: null, message: null,
  });
  expect(await deliverEmail(context, { ...email, notificationType: 'service_inquiry_created', idempotencyKey: 'service-inquiry:1', recipients: [] }, notify)).toBe(false);
  expect(calls).toEqual([]);
  expect(await deliverEmail(context, { ...email, notificationType: 'service_inquiry_created', idempotencyKey: 'service-inquiry:1', recipients: ['admin@shop.example'] }, notify)).toBe(true);
  expect(calls[0]!.path).toBe(SEND_EMAIL_WEBHOOK);
  expect(calls[0]!.payload).toMatchObject({
    notificationType: 'service_inquiry_created', idempotencyKey: 'service-inquiry:1', recipients: ['admin@shop.example'],
    replyTo: 'a@b.it', emailBranding: context.emailBranding,
  });
});
