import { test, expect } from '@playwright/test';
import { PAYMENT_METHOD_REGISTRY, PAYMENT_METHOD_TYPE_KEYS, PAYMENT_MODULE_KEYS, type PaymentMethodType, type PaymentModule, type TenantPaymentMethod } from '@lepefy/types';
import { isOfferedIn, methodsOfferedIn } from '../../src/lib/payments/paymentChannels';
import { isLinkPaymentMethod } from '../../src/lib/payments/externalPaymentLink';
import { publicExternalMethods } from '../../src/lib/orders/assisted/payLinkPublic';
import { cardLandingMethods } from '../../src/lib/card/cardPaymentTiles';
import { paymentMethodAvailability } from '../../src/lib/payments/paymentMethodAvailability';
import { PAYMENT_TYPE_FIELDS } from '../../src/lib/payments/paymentMethodForm';

let seq = 0;
const row = (method: PaymentMethodType, over: Partial<TenantPaymentMethod> = {}): TenantPaymentMethod => ({
  id: `id-${++seq}`, tenant_id: 't', method, label: null, value: null, extra: null,
  sort_order: 0, active: true, enabled_modules: [...PAYMENT_MODULE_KEYS], ...over,
});

const MODULE_SETS: PaymentModule[][] = [[...PAYMENT_MODULE_KEYS], ['shop'], ['card', 'event', 'rental'], ['card']];

// Every type × link/value combination × module scope × active flag.
const SAMPLES: TenantPaymentMethod[] = PAYMENT_METHOD_TYPE_KEYS.flatMap((method) => {
  const shapes: Array<Partial<TenantPaymentMethod>> = PAYMENT_METHOD_REGISTRY[method].storesDetails
    ? [{}, { value: 'FR76 3000 6000 0112 3456 7890 189' }, { extra: { link: 'https://paypal.me/x' } }, { value: 'id', extra: { link: 'https://revolut.me/x' } }]
    : [{}];
  return shapes.flatMap((shape) => MODULE_SETS.flatMap((enabled_modules) => [true, false].map((active) => row(method, { ...shape, enabled_modules, active }))));
});

// Filters as they were written in each customer path before the shared helper.
const before = {
  checkout: (m: TenantPaymentMethod, module: PaymentModule) => m.active && isLinkPaymentMethod(m) && m.enabled_modules.includes(module),
  payLink: (m: TenantPaymentMethod) => m.active && m.enabled_modules.includes('shop') && !['card', 'apple_pay', 'cash'].includes(m.method)
    && (m.method === 'bank_transfer' ? Boolean(m.value) : Boolean(m.extra?.link || m.value)),
  card: (m: TenantPaymentMethod) => m.active && m.enabled_modules.includes('card') && cardLandingMethods([m]).length === 1,
};

test.describe('même résultat que les filtres d’avant', () => {
  test('checkout boutique, événements, location', () => {
    for (const m of SAMPLES) {
      expect(isOfferedIn(m, 'shop_checkout')).toBe(before.checkout(m, 'shop'));
      expect(isOfferedIn(m, 'event')).toBe(before.checkout(m, 'event'));
      expect(isOfferedIn(m, 'rental')).toBe(before.checkout(m, 'rental'));
    }
  });
  test('liens de paiement des commandes assistées', () => {
    for (const m of SAMPLES) expect(isOfferedIn(m, 'shop_pay_link'), `${m.method}`).toBe(before.payLink(m));
    expect(publicExternalMethods(SAMPLES).map((m) => m.id)).toEqual(SAMPLES.filter(before.payLink).map((m) => m.id));
  });
  test('/card', () => {
    for (const m of SAMPLES) expect(isOfferedIn(m, 'card'), m.method).toBe(before.card(m));
  });
  test('l’ordre est conservé', () => {
    const list = [row('other', { extra: { link: 'https://b.c' } }), row('paypal', { extra: { link: 'https://paypal.me/a' } })];
    expect(methodsOfferedIn(list, 'event').map((m) => m.id)).toEqual(list.map((m) => m.id));
  });
});

test.describe('ce qui se ferme', () => {
  test('un moyen non coché pour la boutique est refusé par les routes du checkout', () => {
    const revolut = row('other', { label: 'Revolut', extra: { link: 'https://revolut.me/x' }, enabled_modules: ['card', 'event', 'rental'] });
    // Before: the routes only checked isLinkPaymentMethod + active.
    expect(isLinkPaymentMethod(revolut)).toBe(true);
    expect(isOfferedIn(revolut, 'shop_checkout')).toBe(false);
    expect(isOfferedIn(revolut, 'event')).toBe(true);
  });
  test('une ligne sans enabled_modules (avant la migration 066) vaut tous les services', () => {
    const legacy = { ...row('paypal', { extra: { link: 'https://paypal.me/x' } }), enabled_modules: undefined as unknown as PaymentModule[] };
    expect(isOfferedIn(legacy, 'shop_checkout')).toBe(true);
  });
});

test.describe('registre', () => {
  test('les types sans détails n’ont aucun champ dans l’éditeur', () => {
    for (const type of PAYMENT_METHOD_TYPE_KEYS) {
      expect(Object.keys(PAYMENT_TYPE_FIELDS[type]).length > 0, type).toBe(PAYMENT_METHOD_REGISTRY[type].storesDetails);
    }
  });
  test('la page admin explique exactement la règle des canaux', () => {
    for (const m of SAMPLES) {
      const shop = paymentMethodAvailability(m, 'shop').ok;
      expect(shop).toBe(isOfferedIn({ ...m, active: true, enabled_modules: ['shop'] }, 'shop_checkout') || isOfferedIn({ ...m, active: true, enabled_modules: ['shop'] }, 'shop_pay_link'));
      for (const module of ['card', 'event', 'rental'] as const) {
        expect(paymentMethodAvailability(m, module).ok).toBe(isOfferedIn({ ...m, active: true, enabled_modules: [module] }, module));
      }
    }
  });
});
