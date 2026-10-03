import { test, expect } from '@playwright/test';
import {
  cardNotificationState, cardPaymentDeliveryKeys, cardPaymentsQueryString, isNotificationProblem, parseCardPaymentsState,
} from '../../src/lib/card/cardPaymentsAdmin';

test('delivery keys match the automatic /card emails', () => {
  expect(cardPaymentDeliveryKeys('pi_123')).toEqual({ customer: 'card-quick-payment-customer:pi_123', team: 'card-quick-payment:pi_123' });
});

test('delivery state: only real failures are problems; no ledger row is never a failure', () => {
  const paid = { paid: true, hasRecipient: true };
  expect(cardNotificationState({ status: 'accepted' }, paid)).toBe('sent');
  expect(cardNotificationState({ status: 'pending' }, paid)).toBe('sending');
  expect(cardNotificationState({ status: 'processing' }, paid)).toBe('sending');
  expect(cardNotificationState({ status: 'failed' }, paid)).toBe('retrying');
  expect(cardNotificationState({ status: 'dead' }, paid)).toBe('dead');
  expect(cardNotificationState(undefined, paid)).toBe('untracked');
  expect(cardNotificationState(undefined, { paid: true, hasRecipient: false })).toBe('no_email');
  expect(cardNotificationState({ status: 'dead' }, { paid: false, hasRecipient: true })).toBe('not_applicable');
  expect(['sent', 'sending', 'untracked', 'no_email', 'not_applicable'].some((state) => isNotificationProblem(state as never))).toBe(false);
  expect(isNotificationProblem('retrying') && isNotificationProblem('dead')).toBe(true);
});

test('list state round-trips through the query string, defaults omitted', () => {
  const params = (query: string) => new URLSearchParams(query);
  expect(cardPaymentsQueryString(parseCardPaymentsState(params('')))).toBe('');
  const state = parseCardPaymentsState(params('period=custom&from=2026-09-01&to=2026-09-30&status=paid&q=CP-A82F31&page=3'));
  expect(state).toEqual({ period: 'custom', from: '2026-09-01', to: '2026-09-30', status: 'paid', q: 'CP-A82F31', page: 3 });
  expect(parseCardPaymentsState(params(cardPaymentsQueryString(state)))).toEqual(state);
  // Dates only apply to a custom period; malformed values fall back to defaults.
  expect(parseCardPaymentsState(params('period=30d&from=2026-09-01&status=bogus&page=-2'))).toEqual({ period: '30d', from: '', to: '', status: 'all', q: '', page: 1 });
  expect(parseCardPaymentsState(params('period=custom&from=2026-02-30'))).toMatchObject({ from: '' });
});
