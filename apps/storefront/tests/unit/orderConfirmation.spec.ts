import { test, expect } from '@playwright/test';
import { buildConfirmationOrderView, orderReference } from '../../src/lib/orders/confirmationView';
import {
  paymentIntentIdFromClientSecret,
  readConfirmationAccess,
  rememberConfirmationAccess,
} from '../../src/lib/checkout/confirmationAccess';

const order = {
  id: '713bd03e-1977-4509-9868-b8e6e530e1c3',
  email: 'Client@Example.com',
  fulfillment_type: 'delivery',
  payment_method: 'stripe',
  shipping_address: { full_name: 'Awa Diallo', line1: 'Via Roma 1', postal_code: '20121', city: 'Milano', country: 'IT', phone: '+39 351 000 0000' },
  shipping_cost: '9.90',
  subtotal: 3.5,
  total: '13.40',
} as const;

test.describe('Confirmation : vue de la commande pour son client', () => {
  test('référence, montants en nombres, e-mail tel quel', () => {
    const view = buildConfirmationOrderView(order, [{ id: 'i1', name: 'Jus de bissap 1 L', quantity: 1, subtotal: '3.50' }], 'https://shop.example/o/abc');
    expect(view.reference).toBe('713BD03E');
    expect(orderReference(order.id)).toBe('713BD03E');
    expect(view.email).toBe('Client@Example.com');
    expect(view).toMatchObject({ fulfillmentType: 'delivery', subtotal: 3.5, shippingCost: 9.9, total: 13.4, trackingUrl: 'https://shop.example/o/abc' });
    expect(view.items).toEqual([{ id: 'i1', name: 'Jus de bissap 1 L', quantity: 1, subtotal: 3.5 }]);
  });

  test('jamais l’adresse complète, le téléphone ni le moyen de paiement', () => {
    const view = buildConfirmationOrderView(order, [], null);
    expect(view.deliveryPlace).toBe('20121 Milano, IT');
    const json = JSON.stringify(view);
    for (const secret of ['Via Roma', 'Awa Diallo', '+39 351', 'stripe', 'payment_method', order.id]) expect(json).not.toContain(secret);
  });

  test('retrait : pas de lieu de livraison', () => {
    const view = buildConfirmationOrderView({ ...order, fulfillment_type: 'pickup', shipping_address: null, shipping_cost: 0 }, [], null);
    expect(view.fulfillmentType).toBe('pickup');
    expect(view.deliveryPlace).toBeNull();
  });
});

test.describe('Confirmation : accès gardé dans l’onglet', () => {
  test('id du paiement depuis le client secret', () => {
    expect(paymentIntentIdFromClientSecret('pi_3UQje91MPV0Xkg2K_secret_abc123')).toBe('pi_3UQje91MPV0Xkg2K');
    expect(paymentIntentIdFromClientSecret('seti_1_secret_x')).toBeNull();
    expect(paymentIntentIdFromClientSecret('pi_bad id_secret_x')).toBeNull();
    expect(paymentIntentIdFromClientSecret(null)).toBeNull();
  });

  test('aller-retour par le sessionStorage, rien sans session ni jeton', () => {
    const store = new Map<string, string>();
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } },
    };
    try {
      rememberConfirmationAccess('pi_A1_secret_z', { sessionId: 's-1', accessToken: 'tok' });
      expect(readConfirmationAccess('pi_A1')).toEqual({ sessionId: 's-1', accessToken: 'tok' });
      rememberConfirmationAccess('pi_B2_secret_z', { sessionId: 's-2' });
      expect(readConfirmationAccess('pi_B2')).toBeNull();
      expect(readConfirmationAccess('pi_unknown')).toBeNull();
      expect([...store.keys()].every((key) => !key.includes('tok'))).toBe(true);
    } finally {
      (globalThis as { window?: unknown }).window = previous;
    }
  });

  test('stockage refusé : jamais d’exception', () => {
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { get sessionStorage(): Storage { throw new Error('denied'); } };
    try {
      expect(() => rememberConfirmationAccess('pi_A1_secret_z', { sessionId: 's', accessToken: 't' })).not.toThrow();
      expect(readConfirmationAccess('pi_A1')).toBeNull();
    } finally {
      (globalThis as { window?: unknown }).window = previous;
    }
  });
});
