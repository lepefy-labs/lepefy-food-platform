import { expect, test } from '@playwright/test';
import {
  cardPaymentReference, maskEmail, outcomeFromIntentStatus, paymentIntentIdFromSecret, recallCardPayment, rememberCardPayment,
} from '../../src/lib/card/cardPaymentOutcome';
import { cardPaymentReference as emailReference } from '../../src/lib/notifications/customerEmails';

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, map };
}

test('the success screen and the confirmation email show the same reference', () => {
  expect(cardPaymentReference('a82f31c4-9d1e-4b2a-8c3f-000000000001')).toBe('CP-A82F31');
  expect(emailReference).toBe(cardPaymentReference);
});

test('email is masked for a screen that may be shown to staff', () => {
  expect(maskEmail('marie.dupont@gmail.com')).toBe('m•••@gmail.com');
  expect(maskEmail('  a@b.fr ')).toBe('a•••@b.fr');
  expect(maskEmail('')).toBeNull();
  expect(maskEmail(null)).toBeNull();
  expect(maskEmail('@nodomain')).toBeNull();
});

test('redirect return: only "failed" when nothing was charged, unknown states show nothing', () => {
  expect(outcomeFromIntentStatus('succeeded')).toBe('succeeded');
  expect(outcomeFromIntentStatus('processing')).toBe('processing');
  expect(outcomeFromIntentStatus('requires_capture')).toBe('processing');
  for (const status of ['requires_payment_method', 'requires_action', 'requires_confirmation', 'canceled']) {
    expect(outcomeFromIntentStatus(status)).toBe('failed');
  }
  expect(outcomeFromIntentStatus('something_new')).toBeNull();
  expect(outcomeFromIntentStatus(undefined)).toBeNull();
});

test('receipt survives a redirect in the same tab, keyed by PaymentIntent id', () => {
  expect(paymentIntentIdFromSecret('pi_3Abc_secret_xyz')).toBe('pi_3Abc');
  expect(paymentIntentIdFromSecret('seti_1_secret_x')).toBeNull();
  expect(paymentIntentIdFromSecret(null)).toBeNull();

  const storage = memoryStorage();
  rememberCardPayment('pi_1', { amount: 38, reference: 'CP-A82F31', email: 'marie@example.com' }, storage);
  expect(recallCardPayment('pi_1', storage)).toEqual({ amount: 38, reference: 'CP-A82F31', email: 'marie@example.com' });
  expect(recallCardPayment('pi_other', storage)).toBeNull();

  storage.map.set('lepefy-card-payment:pi_bad', '{not json');
  expect(recallCardPayment('pi_bad', storage)).toBeNull();
  // Blocked storage never breaks the payment screen.
  expect(() => rememberCardPayment('pi_2', { amount: 1, reference: null, email: null }, { setItem: () => { throw new Error('blocked'); } })).not.toThrow();
  expect(recallCardPayment('pi_2', null)).toBeNull();
});
