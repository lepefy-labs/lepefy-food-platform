import { test, expect } from '@playwright/test';
import { deliveryFeeMessage, initialDeliveryFee, normalizeDeliveryFeeAmount } from '../../src/lib/rental/deliveryFee';
import { buildExternalPaymentLink, isLinkPaymentMethod, linkIncludesAmount } from '../../src/lib/payments/externalPaymentLink';
import { RENTAL_DELIVERY_FEE_STATUS_META, statusMeta } from '../../src/lib/admin/statusRegistry';

test.describe('supplément à la création de la réservation', () => {
  test('retrait : sans objet', () => {
    expect(initialDeliveryFee({ fulfillmentType: 'pickup', deliveryZoneId: 'z', deliveryFeeAmount: 12 })).toEqual({ status: 'not_applicable', amount: null });
  });

  test('zone trouvée : supplément déjà inclus dans le paiement', () => {
    expect(initialDeliveryFee({ fulfillmentType: 'delivery', deliveryZoneId: 'z', deliveryFeeAmount: 12 })).toEqual({ status: 'paid', amount: 12 });
    expect(initialDeliveryFee({ fulfillmentType: 'delivery', deliveryZoneId: 'z', deliveryFeeAmount: 0 })).toEqual({ status: 'paid', amount: 0 });
    // Zone supprimée avant la confirmation du lien externe : le montant payé compte.
    expect(initialDeliveryFee({ fulfillmentType: 'delivery', deliveryZoneId: null, deliveryFeeAmount: 15 })).toEqual({ status: 'paid', amount: 15 });
  });

  test('sans zone : à évaluer, jamais 0 € (Stripe envoie « 0 », le lien externe 0)', () => {
    expect(initialDeliveryFee({ fulfillmentType: 'delivery', deliveryZoneId: null, deliveryFeeAmount: 0 })).toEqual({ status: 'pending_quote', amount: null });
    expect(initialDeliveryFee({ fulfillmentType: 'delivery', deliveryZoneId: '', deliveryFeeAmount: Number('0') })).toEqual({ status: 'pending_quote', amount: null });
    expect(initialDeliveryFee({ fulfillmentType: 'delivery' })).toEqual({ status: 'pending_quote', amount: null });
  });
});

test.describe('montant saisi par l’admin', () => {
  test('nombre ou texte avec virgule, arrondi au centime', () => {
    expect(normalizeDeliveryFeeAmount('12,5')).toEqual({ ok: true, amount: 12.5 });
    expect(normalizeDeliveryFeeAmount(9.999)).toEqual({ ok: true, amount: 10 });
    expect(normalizeDeliveryFeeAmount(0)).toEqual({ ok: true, amount: 0 });
  });

  test('valeurs refusées', () => {
    for (const value of [-1, '', ' ', 'abc', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 10000.01]) {
      expect(normalizeDeliveryFeeAmount(value).ok).toBe(false);
    }
  });
});

test.describe('lien et message de paiement', () => {
  const paypal = { method: 'paypal', extra: { link: 'https://paypal.me/chloefood/' } };
  const satispay = { method: 'satispay', extra: { link: 'https://tag.satispay.com/chloefood' } };

  test('PayPal avec montant, autres liens inchangés, virement et espèces exclus', () => {
    expect(buildExternalPaymentLink(paypal, 12, 'eur')).toBe('https://paypal.me/chloefood/12.00EUR');
    expect(linkIncludesAmount(paypal)).toBe(true);
    expect(buildExternalPaymentLink(satispay, 12, 'EUR')).toBe('https://tag.satispay.com/chloefood');
    expect(linkIncludesAmount(satispay)).toBe(false);
    expect(isLinkPaymentMethod({ method: 'bank_transfer', extra: { link: 'x' } })).toBe(false);
    expect(isLinkPaymentMethod({ method: 'cash', extra: { link: 'x' } })).toBe(false);
    expect(buildExternalPaymentLink({ method: 'revolut', extra: { link: '' } }, 12, 'EUR')).toBeNull();
  });

  test('message au client : prénom, date, montant, lien', () => {
    expect(deliveryFeeMessage({ customerName: 'Awa Ndiaye', dateLabel: '18/10/2026', amountLabel: '12,00 €', link: 'https://paypal.me/chloefood/12.00EUR' }))
      .toBe('Bonjour Awa, le supplément de livraison pour votre location du 18/10/2026 est de 12,00 €. Vous pouvez le régler ici : https://paypal.me/chloefood/12.00EUR');
    expect(deliveryFeeMessage({ customerName: ' ', dateLabel: '18/10/2026', amountLabel: '12,00 €', link: null }))
      .toBe('Bonjour, le supplément de livraison pour votre location du 18/10/2026 est de 12,00 €. Nous vous dirons comment le régler.');
  });
});

test('états du supplément : libellé et ton du registre', () => {
  expect(statusMeta(RENTAL_DELIVERY_FEE_STATUS_META, 'pending_quote')).toEqual({ label: 'À évaluer', tone: 'warning' });
  expect(statusMeta(RENTAL_DELIVERY_FEE_STATUS_META, 'quoted')).toEqual({ label: 'En attente du paiement', tone: 'info' });
  expect(statusMeta(RENTAL_DELIVERY_FEE_STATUS_META, 'paid')).toEqual({ label: 'Payé', tone: 'success' });
});
