import { test, expect } from '@playwright/test';
import type { PaymentMethodType, PaymentModule, TenantPaymentMethod } from '@lepefy/types';
import { customerView, effectiveModules, isVisibleNowhere, paymentMethodAvailability } from '../../src/lib/payments/paymentMethodAvailability';
import { isLinkPaymentMethod } from '../../src/lib/payments/externalPaymentLink';
import { publicExternalMethods } from '../../src/lib/orders/assisted/payLinkPublic';
import { cardLandingMethods } from '../../src/lib/card/cardPaymentTiles';

const ALL: PaymentModule[] = ['shop', 'card', 'event', 'rental'];
let seq = 0;
const row = (method: PaymentMethodType, over: Partial<TenantPaymentMethod> = {}): TenantPaymentMethod => ({
  id: `id-${++seq}`, tenant_id: 't', method, label: null, value: null, extra: null,
  sort_order: 0, active: true, enabled_modules: [...ALL], ...over,
});

// Every type with every combination of link / value the editor can produce.
const SAMPLES: TenantPaymentMethod[] = (['card', 'apple_pay', 'cash', 'bank_transfer', 'paypal', 'satispay', 'other'] as PaymentMethodType[])
  .flatMap((method) => [
    row(method),
    row(method, { value: 'FR76 3000 6000 0112 3456 7890 189' }),
    row(method, { extra: { link: 'https://paypal.me/x' } }),
    row(method, { value: 'id', extra: { link: 'https://revolut.me/x' } }),
  ])
  // card / apple_pay / cash never store value or extra (API hasNoValueFields).
  .filter((m) => !['card', 'apple_pay', 'cash'].includes(m.method) || (m.value === null && m.extra === null));

test.describe('parité avec les parcours client', () => {
  test('Boutique = checkout (lien) ∪ liens de paiement des commandes assistées', () => {
    const viaPayLink = new Set(publicExternalMethods(SAMPLES).map((m) => m.id));
    for (const m of SAMPLES) {
      const real = isLinkPaymentMethod(m) || viaPayLink.has(m.id);
      expect(paymentMethodAvailability(m, 'shop').ok, `${m.method} ${JSON.stringify([m.value, m.extra])}`).toBe(real);
    }
  });
  test('/card = cardLandingMethods', () => {
    const real = new Set(cardLandingMethods(SAMPLES).map((m) => m.id));
    for (const m of SAMPLES) expect(paymentMethodAvailability(m, 'card').ok, m.method).toBe(real.has(m.id));
  });
  test('Événements et Location = isLinkPaymentMethod', () => {
    for (const m of SAMPLES) {
      expect(paymentMethodAvailability(m, 'event').ok, m.method).toBe(isLinkPaymentMethod(m));
      expect(paymentMethodAvailability(m, 'rental').ok, m.method).toBe(isLinkPaymentMethod(m));
    }
  });
});

test.describe('lecture admin', () => {
  test('les espèces ne sont visibles nulle part', () => {
    const cash = row('cash');
    expect(effectiveModules(cash)).toEqual([]);
    expect(isVisibleNowhere(cash)).toBe(true);
    expect(isVisibleNowhere({ ...cash, active: false })).toBe(false);
  });
  test('la carte n’agit que sur /card', () => {
    expect(effectiveModules(row('card'))).toEqual(['card']);
  });
  test('virement avec IBAN : boutique (liens) et /card', () => {
    expect(effectiveModules(row('bank_transfer', { value: 'FR76…' }))).toEqual(['shop', 'card']);
  });
  test('vue client : ordre conservé, cochés sans effet listés à part, inactifs ignorés', () => {
    const paypal = row('paypal', { extra: { link: 'https://paypal.me/x' } });
    const cash = row('cash');
    const off = row('satispay', { extra: { link: 'https://s.x' }, active: false });
    const revolut = row('other', { label: 'Revolut', extra: { link: 'https://revolut.me/x' }, enabled_modules: ['card'] });
    const view = customerView([paypal, cash, off, revolut], 'event');
    expect(view.shown.map((m) => m.id)).toEqual([paypal.id]);
    expect(view.ignored.map((i) => i.method.id)).toEqual([cash.id]);
  });
});
