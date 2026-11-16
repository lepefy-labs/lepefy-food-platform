import { test, expect } from '@playwright/test';
import { whatsappContactLink, whatsappContactMessage, whatsappNumber } from '../../src/lib/orders/customerWhatsapp';
import { orderDataIssues } from '../../src/lib/orders/dataQuality/orderDataIssues';
import { staffAlertEmail } from '../../src/lib/notifications/operationalEmails';
import { orderDataIssueAlert, type OrderFacts } from '../../src/lib/notifications/staff/staffMessages';

test.describe('contact client sur WhatsApp (détail commande)', () => {
  test('numéro : E.164 en chiffres, ancien format national lu avec le pays de livraison', () => {
    expect(whatsappNumber('+393509185291', 'IT')).toBe('393509185291');
    expect(whatsappNumber('3493957175', 'IT')).toBe('393493957175');
    expect(whatsappNumber('0032471312994', 'BE')).toBe('32471312994');
    expect(whatsappNumber('0471312994', 'BE')).toBe('32471312994');
    expect(whatsappNumber('12', 'IT')).toBeNull();
    expect(whatsappNumber(null, 'IT')).toBeNull();
  });

  test('message : salutation simple, question précise quand l’adresse est incomplète', () => {
    expect(whatsappContactMessage({ customerName: 'Marie Kamga', tenantName: 'Chloe Food', orderReference: '#0942BA91' }))
      .toBe('Bonjour Marie, ici Chloe Food, au sujet de votre commande #0942BA91.');
    const issues = orderDataIssues({
      status: 'preparing', fulfillment_type: 'delivery', tracking_code: null,
      shipping_address: { full_name: 'Rosah alexandra Assen', line1: 'Via felice mendelsohnn Alexandra rosah Assen' },
    });
    expect(whatsappContactMessage({ customerName: 'ROSAH alexandra Assen', tenantName: 'Chloe Food', orderReference: '#AE9D9FBF', issues }))
      .toBe('Bonjour Rosah, ici Chloe Food, au sujet de votre commande #AE9D9FBF.\nPour livrer votre colis, pourriez-vous nous indiquer le numéro de votre maison et le nom exact de votre rue ?\nMerci !');
  });

  test('lien wa.me encodé, rien sans numéro valide', () => {
    expect(whatsappContactLink('393509185291', 'Bonjour ?\nMerci'))
      .toBe('https://wa.me/393509185291?text=Bonjour%20%3F%0AMerci');
    expect(whatsappContactLink(null, 'x')).toBeNull();
    expect(whatsappContactLink('+39 350', 'x')).toBeNull();
  });
});

test('e-mail interne : lien direct vers la commande en haut, en plus du bouton', () => {
  const facts = {
    orderId: 'ae9d9fbf-3e16-41c9-8504-e463515a12d7', orderNumber: '#AE9D9FBF', customer: 'Rosah A.', total: 107.49, items: 5,
    fulfillment: 'delivery', paymentLabel: 'Carte', paymentPending: false, destinationCountry: 'IT', international: false,
    fresh: false, frozen: false, assisted: false, shipment: null,
  } as OrderFacts;
  const alert = orderDataIssueAlert(facts, ['le numéro de la maison manque'], ['Étape 1']);
  const html = staffAlertEmail({ tenantName: 'Chloe Food', storefrontUrl: 'https://shop.chloefood.com', branding: { primaryColor: '#1267C7' } } as never, alert).html;
  const url = 'https://shop.chloefood.com/admin/orders/ae9d9fbf-3e16-41c9-8504-e463515a12d7';
  expect(html.split(`href="${url}"`)).toHaveLength(3);
  // The text link comes before the steps.
  expect(html.indexOf(`href="${url}"`)).toBeLessThan(html.indexOf('Que faire'));
});
