import { expect, test } from '@playwright/test';
import {
  activityBuckets,
  bucketIndexFor,
  bucketSizeFor,
  conversionFunnel,
  distinctConversationKeys,
  isCountableOrder,
  localDateKey,
  redactMessage,
} from '../../src/lib/admin/nalaAnalyticsRules';
import { parseNalaDashboardRange } from '../../src/lib/admin/nalaAnalyticsDashboard';

test('messages are redacted and truncated', () => {
  expect(redactMessage('écrivez-moi à marie.k@gmail.com svp')).toBe('écrivez-moi à [e-mail] svp');
  expect(redactMessage('mon numéro +39 329 695 8822 merci')).toBe('mon numéro [téléphone] merci');
  expect(redactMessage('06.12.34.56.78')).toBe('[téléphone]');
  // Quantities and prices are not phone numbers.
  expect(redactMessage('2 kg de riz à 12,50 €')).toBe('2 kg de riz à 12,50 €');
  expect(redactMessage('  vous   avez\n du foufou ? ')).toBe('vous avez du foufou ?');
  const long = redactMessage('a'.repeat(300));
  expect(long).toHaveLength(120);
  expect(long.endsWith('…')).toBe(true);
  expect(redactMessage(null)).toBe('');
});

test('only real paid orders count as assisted revenue', () => {
  expect(isCountableOrder({ is_test: false, status: 'delivered', payment_status: 'paid' })).toBe(true);
  expect(isCountableOrder({ is_test: true, status: 'delivered', payment_status: 'paid' })).toBe(false);
  expect(isCountableOrder({ is_test: false, status: 'cancelled', payment_status: 'paid' })).toBe(false);
  expect(isCountableOrder({ is_test: false, status: 'new', payment_status: 'refunded' })).toBe(false);
  expect(isCountableOrder(undefined)).toBe(false);
});

test('local day uses the shop time zone', () => {
  // 23:30 UTC on 4 Oct is already 5 Oct in Rome (UTC+2).
  expect(localDateKey('2026-10-04T23:30:00Z')).toBe('2026-10-05');
  expect(localDateKey('2026-10-04T21:30:00Z')).toBe('2026-10-04');
});

test('buckets cover the whole range', () => {
  const now = new Date('2026-10-05T10:00:00Z');
  expect(bucketSizeFor(7)).toBe('day');
  expect(bucketSizeFor(30)).toBe('day');
  expect(bucketSizeFor(90)).toBe('week');

  const week = activityBuckets(7, now);
  expect(week).toHaveLength(7);
  expect(week[0]?.from).toBe('2026-09-29');
  expect(week[6]?.to).toBe('2026-10-05');

  const quarter = activityBuckets(90, now);
  expect(quarter).toHaveLength(13);
  expect(quarter[12]).toMatchObject({ from: '2026-09-29', to: '2026-10-05' });
  expect(quarter[0]?.from).toBe('2026-07-07');
  expect(bucketIndexFor(quarter, '2026-10-01T08:00:00Z')).toBe(12);
  expect(bucketIndexFor(quarter, '2026-07-07T08:00:00Z')).toBe(0);
  expect(bucketIndexFor(quarter, '2026-07-01T08:00:00Z')).toBe(-1);
});

test('funnel rates are shares of conversations', () => {
  const funnel = conversionFunnel({ conversations: 26, cart: 9, checkout: 0, order: 0 });
  expect(funnel.map((step) => step.count)).toEqual([26, 9, 0, 0]);
  expect(funnel[1]?.rate).toBe(34.6);
  expect(conversionFunnel({ conversations: 0, cart: 0, checkout: 0, order: 0 })[0]?.rate).toBe(0);
  expect(distinctConversationKeys([
    { nala_session_id: 's1', nala_interaction_id: 'i1' },
    { nala_session_id: 's1', nala_interaction_id: 'i2' },
    { nala_session_id: null, nala_interaction_id: 'i3' },
    { nala_session_id: null, nala_interaction_id: null },
  ])).toBe(3);
});

test('range parsing', () => {
  expect(parseNalaDashboardRange('7')).toBe(7);
  expect(parseNalaDashboardRange(['90'])).toBe(90);
  expect(parseNalaDashboardRange('365')).toBe(30);
  expect(parseNalaDashboardRange(undefined)).toBe(30);
});
