import { expect, test } from '@playwright/test';
import {
  DUPLICATE_WINDOW_SECONDS,
  UNUSUAL_AMOUNT_EUR,
  cardLastDigits,
  findRecentDuplicate,
  formatSecondsAgo,
  isUnusualAmount,
  maskEmail,
  parseScanAmount,
  previewPurchasePoints,
  sanitizeScanSearch,
} from '../../src/lib/loyalty/loyaltyScan';

test.describe('parseScanAmount', () => {
  test('accepts comma, dot, spaces and euro sign', () => {
    expect(parseScanAmount('50')).toBe(50);
    expect(parseScanAmount('50,5')).toBe(50.5);
    expect(parseScanAmount('12.30 €')).toBe(12.3);
    expect(parseScanAmount('1 234,50')).toBe(1234.5);
    expect(parseScanAmount('9,999')).toBe(10);
  });

  test('rejects empty, zero, negative and garbage', () => {
    for (const raw of ['', '0', '0,00', '-5', 'abc', '5,0,0', '1e3']) {
      expect(parseScanAmount(raw), raw).toBeNull();
    }
  });
});

test.describe('previewPurchasePoints', () => {
  test('mirrors round(p_amount * rate) of the RPC', () => {
    expect(previewPurchasePoints(25, 1)).toBe(25);
    expect(previewPurchasePoints(24.5, 1)).toBe(25);
    expect(previewPurchasePoints(24.49, 1)).toBe(24);
    expect(previewPurchasePoints(10, 1.5)).toBe(15);
    expect(previewPurchasePoints(0.3, 5)).toBe(2); // 1.5 rounds half away from zero
    expect(previewPurchasePoints(1.15, 10)).toBe(12); // 11.5, no float drift to 11.499…
  });

  test('is zero for invalid inputs', () => {
    expect(previewPurchasePoints(0, 1)).toBe(0);
    expect(previewPurchasePoints(10, 0)).toBe(0);
  });
});

test('unusual amount threshold', () => {
  expect(isUnusualAmount(UNUSUAL_AMOUNT_EUR)).toBe(false);
  expect(isUnusualAmount(UNUSUAL_AMOUNT_EUR + 0.01)).toBe(true);
  expect(isUnusualAmount(5000)).toBe(true);
});

test('maskEmail never exposes the local part', () => {
  expect(maskEmail('alice@gmail.com')).toBe('a***@gmail.com');
  expect(maskEmail('b@x.fr')).toBe('b***@x.fr');
  expect(maskEmail('broken')).toBe('***');
  expect(maskEmail(null)).toBeNull();
});

test('cardLastDigits', () => {
  expect(cardLastDigits('2000000000388')).toBe('0388');
  expect(cardLastDigits('123')).toBeNull();
  expect(cardLastDigits(null)).toBeNull();
});

test.describe('findRecentDuplicate', () => {
  const now = new Date('2026-10-04T10:00:00Z');
  const ago = (s: number) => new Date(now.getTime() - s * 1000).toISOString();

  test('finds the youngest identical amount inside the window', () => {
    const purchases = [
      { amount: '25.00', created_at: ago(90) },
      { amount: 25, created_at: ago(40) },
      { amount: 30, created_at: ago(5) },
    ];
    expect(findRecentDuplicate(purchases, 25, now)).toBe(40);
  });

  test('ignores other amounts and purchases outside the window', () => {
    expect(findRecentDuplicate([{ amount: 25.01, created_at: ago(10) }], 25, now)).toBeNull();
    expect(findRecentDuplicate([{ amount: 25, created_at: ago(DUPLICATE_WINDOW_SECONDS + 1) }], 25, now)).toBeNull();
    expect(findRecentDuplicate([], 25, now)).toBeNull();
  });
});

test('formatSecondsAgo', () => {
  expect(formatSecondsAgo(40)).toBe('il y a 40 s');
  expect(formatSecondsAgo(119)).toBe('il y a 1 min');
});

test('sanitizeScanSearch strips PostgREST filter syntax', () => {
  expect(sanitizeScanSearch('  Dupont,full_name.eq.x)  ')).toBe('Dupontfull_name.eq.x');
  expect(sanitizeScanSearch('06 12 34')).toBe('06 12 34');
});
