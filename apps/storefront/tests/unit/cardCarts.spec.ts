import { test, expect } from '@playwright/test';
import {
  CARD_CART_OUTCOME_META,
  classifyCardCart,
  declineReason,
  dedupeStripeFailures,
  describeStripeIntent,
  journeyLabel,
  paymentFailureDetail,
  stripeDashboardUrl,
} from '../../src/lib/payments/cardCartOutcome';
import {
  cartRecoveryMode,
  COMEBACK_WINDOW_DAYS,
  generateCartComebackToken,
  isValidCartComebackToken,
  isWithinComebackWindow,
  rebuildCartLines,
} from '../../src/lib/checkout/cartComeback';
import { generateCheckoutSessionAccessToken } from '../../src/lib/checkout/checkoutSessionAccessToken';
import { CARD_CART_STATUS_META } from '../../src/lib/admin/statusRegistry';

const ev = (event_type: string, detail: Record<string, unknown> | null = null) => ({ event_type, created_at: '2026-10-11T16:10:58Z', detail });

test.describe('Panier carte : ce que dit le journal', () => {
  test('le plus parlant gagne', () => {
    expect(classifyCardCart([])).toBe('not_started');
    expect(classifyCardCart([ev('checkout_started')])).toBe('not_started');
    expect(classifyCardCart([ev('elements_mounted'), ev('abandoned_payment_form')])).toBe('left_form');
    // Cas réel du 11/10 : intent créé (= « Payer » cliqué, paiement différé), page quittée.
    expect(classifyCardCart([ev('checkout_started'), ev('intent_created')])).toBe('left_after_pay');
    expect(classifyCardCart([ev('intent_created'), ev('requires_action')])).toBe('authentication_pending');
    expect(classifyCardCart([ev('requires_action'), ev('confirm_error')])).toBe('authentication_pending');
    expect(classifyCardCart([ev('confirm_error'), ev('payment_failed_server')])).toBe('declined');
    expect(classifyCardCart([ev('payment_failed_server'), ev('confirm_succeeded_client')])).toBe('succeeded');
  });

  test('libellés lisibles, motif en clair, rappels', () => {
    expect(journeyLabel(ev('intent_created'))).toBe('Paiement créé chez Stripe');
    expect(journeyLabel(ev('payment_failed_server', { code: 'card_declined', decline_code: 'insufficient_funds' }))).toBe('Paiement refusé : fonds insuffisants');
    expect(journeyLabel(ev('checkout_reused', { kind: 'payment_reminder_sent' }))).toBe('Rappel envoyé au client');
    expect(journeyLabel(ev('checkout_reused', { kind: 'other' }))).toBeNull();
    expect(declineReason('unknown_code', 'card_declined')).toBe('Refusé par la banque');
    expect(declineReason(null, null)).toBeNull();
  });

  test('chaque résultat a un état admin (ton du registre)', () => {
    for (const key of Object.keys(CARD_CART_OUTCOME_META)) expect(CARD_CART_STATUS_META[key]?.label).toBeTruthy();
  });
});

test.describe('Lecture Stripe en français', () => {
  const base = { id: 'pi_1', amount: 4830, currency: 'eur', created: 1791900658 };

  test('3-D Secure non terminé', () => {
    const view = describeStripeIntent({ ...base, status: 'requires_action' });
    expect(view.statusLabel).toBe('Vérification bancaire non terminée');
    expect(view.amount).toBe(48.3);
    expect(view.currency).toBe('EUR');
    expect(view.charged).toBe(false);
  });

  test('refus avec motif, réseau et 4 derniers chiffres seulement', () => {
    const view = describeStripeIntent({
      ...base, status: 'requires_payment_method',
      last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' },
      latest_charge: { status: 'failed', created: 1791900660, failure_code: 'card_declined', payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } } },
    });
    expect(view.statusLabel).toBe('Paiement refusé');
    expect(view.tone).toBe('danger');
    expect(view.explanation).toContain('Fonds insuffisants');
    expect(view.card).toBe('Visa ·· 4242');
    expect(view.lastAttempt).toMatchObject({ result: 'Refusé', reason: 'Fonds insuffisants' });
    expect(view.errorCode).toBe('insufficient_funds');
  });

  test('échec sans transaction = non abouti (cas du 11/10), jamais « refusé par la banque »', () => {
    const view = describeStripeIntent({
      ...base, status: 'requires_payment_method',
      last_payment_error: { code: 'payment_intent_authentication_failure', type: 'invalid_request_error', payment_method: { card: { brand: 'mastercard', last4: '4444' } } },
    });
    expect(view.statusLabel).toBe('Paiement non abouti');
    expect(view.tone).toBe('warning');
    expect(view.explanation).toContain('3-D Secure');
    expect(view.card).toBe('Mastercard ·· 4444');
    expect(view.lastAttempt).toEqual({ at: null, result: 'Non aboutie', reason: 'Vérification 3-D Secure abandonnée ou échouée' });
    expect(view.errorCode).toBe('payment_intent_authentication_failure');

    const unknown = describeStripeIntent({ ...base, status: 'requires_payment_method', last_payment_error: { code: 'some_new_code', payment_method: 'pm_1' } });
    expect(unknown.statusLabel).toBe('Paiement non abouti');
    expect(unknown.card).toBeNull();
    expect(unknown.errorCode).toBe('some_new_code');
    expect(unknown.lastAttempt).toEqual({ at: null, result: 'Non aboutie', reason: null });
  });

  test('tentative expirée (cas réel du 11/10) : vérification bancaire non terminée', () => {
    const view = describeStripeIntent({ ...base, status: 'requires_payment_method', last_payment_error: { code: 'payment_intent_payment_attempt_expired', type: 'invalid_request_error' } });
    expect(view.statusLabel).toBe('Paiement non abouti');
    expect(view.explanation).toContain('n’a pas terminé la vérification demandée par sa banque');
    expect(view.lastAttempt).toEqual({ at: null, result: 'Non aboutie', reason: 'Vérification bancaire non terminée à temps' });
    const expired = ev('payment_failed_server', { code: 'payment_intent_payment_attempt_expired' });
    expect(classifyCardCart([ev('intent_created'), expired])).toBe('authentication_pending');
    expect(journeyLabel(expired)).toBe('Vérification 3-D Secure non aboutie');
  });

  test('un évènement Stripe reçu par deux webhooks n’apparaît qu’une fois', () => {
    const failure = ev('payment_failed_server', { stripe_event_id: 'evt_1', code: 'card_declined' });
    const events = [ev('confirm_attempted'), failure, { ...failure }, ev('payment_failed_server', { stripe_event_id: 'evt_2' }), ev('confirm_error')];
    expect(dedupeStripeFailures(events).map((event) => event.event_type))
      .toEqual(['confirm_attempted', 'payment_failed_server', 'payment_failed_server', 'confirm_error']);
  });

  test('un échec 3-D Secure du webhook n’est pas un refus de la banque', () => {
    const authFailure = ev('payment_failed_server', { code: 'payment_intent_authentication_failure' });
    expect(classifyCardCart([ev('intent_created'), authFailure])).toBe('authentication_pending');
    expect(journeyLabel(authFailure)).toBe('Vérification 3-D Secure non aboutie');
    expect(classifyCardCart([authFailure, ev('payment_failed_server', { code: 'card_declined' })])).toBe('declined');
  });

  test('carte jamais validée, payé, annulé', () => {
    expect(describeStripeIntent({ ...base, status: 'requires_payment_method' }).statusLabel).toBe('Carte jamais validée');
    expect(describeStripeIntent({ ...base, status: 'succeeded' }).charged).toBe(true);
    expect(describeStripeIntent({ ...base, status: 'canceled' }).statusLabel).toBe('Annulé');
  });

  test('lien du tableau de bord et détail enregistré (aucune donnée carte)', () => {
    expect(stripeDashboardUrl('pi_1', false)).toBe('https://dashboard.stripe.com/payments/pi_1');
    expect(stripeDashboardUrl('pi_1', true)).toBe('https://dashboard.stripe.com/test/payments/pi_1');
    const detail = paymentFailureDetail({ eventId: 'evt_1', paymentIntentId: 'pi_1', lastPaymentError: { code: 'card_declined', decline_code: 'do_not_honor', type: 'card_error', payment_method: { type: 'card' } } });
    expect(detail).toEqual({ stripe_event_id: 'evt_1', payment_intent_id: 'pi_1', code: 'card_declined', decline_code: 'do_not_honor', error_type: 'card_error', payment_method_type: 'card' });
  });
});

test.describe('Relance : reprise ou « Retrouver mon panier »', () => {
  const now = new Date('2026-10-15T10:00:00Z');
  const session = (over: object) => ({ status: 'open', payment_method: 'stripe', expires_at: '2026-10-16T10:00:00Z', created_at: '2026-10-15T09:00:00Z', order_id: null, ...over });

  test('carte : ouverte = reprise, expirée = retrouver (14 jours), commandée = rien', () => {
    expect(cartRecoveryMode(session({}), now)).toBe('resume');
    expect(cartRecoveryMode(session({ status: 'expired', created_at: '2026-10-11T16:10:58Z', expires_at: '2026-10-12T16:10:57Z' }), now)).toBe('comeback');
    expect(cartRecoveryMode(session({ status: 'open', expires_at: '2026-10-12T16:10:57Z', created_at: '2026-10-11T16:10:58Z' }), now)).toBe('comeback');
    expect(cartRecoveryMode(session({ status: 'expired', created_at: '2026-09-20T10:00:00Z' }), now)).toBe('none');
    expect(cartRecoveryMode(session({ order_id: 'o1' }), now)).toBe('none');
    expect(cartRecoveryMode(session({ status: 'cancelled' }), now)).toBe('none');
  });

  test('paiement externe : règles inchangées', () => {
    expect(cartRecoveryMode(session({ payment_method: 'external_link' }), now)).toBe('resume');
    expect(cartRecoveryMode(session({ payment_method: 'external_link', status: 'awaiting_verification' }), now)).toBe('resume');
    expect(cartRecoveryMode(session({ payment_method: 'external_link', status: 'expired' }), now)).toBe('none');
  });

  test('fenêtre de 14 jours', () => {
    expect(COMEBACK_WINDOW_DAYS).toBe(14);
    expect(isWithinComebackWindow('2026-10-01T10:00:00Z', now)).toBe(true);
    expect(isWithinComebackWindow('2026-09-30T09:59:00Z', now)).toBe(false);
  });

  test('lien signé distinct du lien de reprise', () => {
    const previous = process.env.TRACKING_SECRET;
    process.env.TRACKING_SECRET = 'test-secret';
    try {
      const token = generateCartComebackToken('s1', 'Awa@Example.com');
      expect(isValidCartComebackToken('s1', 'awa@example.com', token)).toBe(true);
      expect(isValidCartComebackToken('s2', 'awa@example.com', token)).toBe(false);
      expect(isValidCartComebackToken('s1', 'awa@example.com', generateCheckoutSessionAccessToken('s1', 'awa@example.com'))).toBe(false);
      expect(isValidCartComebackToken('s1', 'awa@example.com', 'pas-un-jeton')).toBe(false);
      expect(isValidCartComebackToken('s1', 'awa@example.com', null)).toBe(false);
    } finally {
      process.env.TRACKING_SECRET = previous;
    }
  });

  test('panier reconstruit : prix du jour, quantités achetables, produits retirés', () => {
    const products = [
      { id: 'a', name: 'Bobolo', price: 3.2, stock: 10, min_order_quantity: 1, order_quantity_step: 1 },
      { id: 'b', name: 'Koki', price: 3, stock: 50, min_order_quantity: 4, order_quantity_step: 2 },
      { id: 'c', name: 'Gari', price: 2, stock: 3, min_order_quantity: 6, order_quantity_step: 6 },
      { id: 'd', name: 'Placali', price: 5, stock: 2, min_order_quantity: 1, order_quantity_step: 1 },
    ];
    const lines = rebuildCartLines([
      { productId: 'a', name: 'Bobolo', quantity: 2, price: 3 },
      { productId: 'b', name: 'Koki', quantity: 3, price: 3 },
      { productId: 'c', name: 'Gari', quantity: 6, price: 2 },
      { productId: 'd', name: 'Placali', quantity: 5, price: 5 },
      { productId: 'gone', name: 'Kaolin', quantity: 1, price: 2.5 },
    ], products);
    expect(lines.map((l) => [l.name, l.quantity, l.adjusted, l.unitPrice])).toEqual([
      ['Bobolo', 2, false, 3.2],
      ['Koki', 4, true, 3],
      ['Gari', 0, false, 2],
      ['Placali', 2, true, 5],
      ['Kaolin', 0, false, null],
    ]);
  });
});
