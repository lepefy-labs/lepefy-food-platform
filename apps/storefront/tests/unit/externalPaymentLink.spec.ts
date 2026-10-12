import { test, expect } from '@playwright/test';
import { applyLinkAmount, buildExternalPaymentLink, isLinkPaymentMethod, linkIncludesAmount } from '../../src/lib/payments/externalPaymentLink';

const paypal = (link: string) => ({ method: 'paypal', extra: { link } });

// Formule recopiée dans les checkouts avant la règle partagée.
const previousFormula = (link: string, amount: number, currency: string) => `${link.replace(/\/+$/, '')}/${amount.toFixed(2)}${currency}`;

test.describe('lien PayPal.me', () => {
  test('identique à l’ancienne formule pour les liens PayPal.me simples', () => {
    for (const link of [
      'https://www.paypal.me/chloefood',
      'https://paypal.me/chloefood',
      'https://paypal.me/chloefood/',
      'https://paypal.me/chloefood///',
      'https://www.paypal.com/paypalme/chloefood',
      'https://PayPal.Me/ChloeFood',
    ]) {
      for (const amount of [0, 1, 25, 25.5, 1234.567]) {
        expect(buildExternalPaymentLink(paypal(link), amount, 'EUR')).toBe(previousFormula(link, amount, 'EUR'));
      }
      expect(linkIncludesAmount(paypal(link))).toBe(true);
    }
  });

  test('un montant déjà présent est remplacé', () => {
    expect(buildExternalPaymentLink(paypal('https://paypal.me/chloefood/10EUR'), 25, 'eur')).toBe('https://paypal.me/chloefood/25.00EUR');
    expect(buildExternalPaymentLink(paypal('https://paypal.me/chloefood/10.50EUR/'), 25, 'EUR')).toBe('https://paypal.me/chloefood/25.00EUR');
    expect(buildExternalPaymentLink(paypal('https://www.paypal.com/paypalme/chloefood/9,90EUR'), 25, 'EUR')).toBe('https://www.paypal.com/paypalme/chloefood/25.00EUR');
    // Ricalcolo di una sessione : lien enregistré avec le montant précédent.
    expect(buildExternalPaymentLink(paypal('https://www.paypal.me/chloefood/18.40EUR'), 21.9, 'EUR')).toBe('https://www.paypal.me/chloefood/21.90EUR');
  });

  test('le nom n’est jamais pris pour un montant', () => {
    expect(buildExternalPaymentLink(paypal('https://paypal.me/10EUR'), 25, 'EUR')).toBe('https://paypal.me/10EUR/25.00EUR');
  });

  test('requête et ancre conservées après le montant, espaces retirés', () => {
    expect(buildExternalPaymentLink(paypal('https://paypal.me/chloefood?locale.x=fr_FR'), 25, 'EUR')).toBe('https://paypal.me/chloefood/25.00EUR?locale.x=fr_FR');
    expect(buildExternalPaymentLink(paypal('  https://paypal.me/chloefood  '), 25, 'EUR')).toBe('https://paypal.me/chloefood/25.00EUR');
    expect(buildExternalPaymentLink(paypal('paypal.me/chloefood'), 25, 'EUR')).toBe('paypal.me/chloefood/25.00EUR');
  });
});

test.describe('autres liens', () => {
  test('lien PayPal qui n’est pas PayPal.me : inchangé, montant à saisir', () => {
    const donate = paypal('https://www.paypal.com/donate?hosted_button_id=ABC');
    expect(buildExternalPaymentLink(donate, 25, 'EUR')).toBe('https://www.paypal.com/donate?hosted_button_id=ABC');
    expect(linkIncludesAmount(donate)).toBe(false);
    expect(linkIncludesAmount(paypal('https://paypal.me/'))).toBe(false);
    expect(linkIncludesAmount(paypal('https://evil.example/paypal.me/x'))).toBe(false);
  });

  test('Satispay, Revolut, autre : lien inchangé', () => {
    const revolut = { method: 'other', extra: { link: 'https://revolut.me/chloefood' } };
    expect(buildExternalPaymentLink(revolut, 25, 'EUR')).toBe('https://revolut.me/chloefood');
    expect(linkIncludesAmount(revolut)).toBe(false);
    // Même un lien paypal.me sous un autre moyen ne reçoit pas de montant.
    expect(buildExternalPaymentLink({ method: 'other', extra: { link: 'https://paypal.me/x' } }, 25, 'EUR')).toBe('https://paypal.me/x');
  });

  test('moyens sans lien', () => {
    expect(isLinkPaymentMethod({ method: 'bank_transfer', extra: { link: 'https://x' } })).toBe(false);
    expect(isLinkPaymentMethod({ method: 'cash', extra: { link: 'https://x' } })).toBe(false);
    expect(isLinkPaymentMethod({ method: 'paypal', extra: { link: '   ' } })).toBe(false);
    expect(isLinkPaymentMethod({ method: 'paypal', extra: null })).toBe(false);
    expect(isLinkPaymentMethod(null)).toBe(false);
    expect(buildExternalPaymentLink({ method: 'cash', extra: { link: 'https://x' } }, 25, 'EUR')).toBeNull();
  });

  test('lien de précommande assistée : même règle, virement avec lien inchangé', () => {
    expect(applyLinkAmount('paypal', 'https://paypal.me/chloe/', 24.5, 'eur')).toBe('https://paypal.me/chloe/24.50EUR');
    expect(applyLinkAmount('paypal', 'https://www.paypal.com/donate?hosted_button_id=ABC', 24.5, 'EUR')).toBe('https://www.paypal.com/donate?hosted_button_id=ABC');
    expect(applyLinkAmount('bank_transfer', ' https://bank.example/pay ', 24.5, 'EUR')).toBe('https://bank.example/pay');
  });
});
