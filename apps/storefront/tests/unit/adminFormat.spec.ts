import { test, expect } from '@playwright/test';
import { formatDate, formatMoney, formatRelative, formatWeight, pluralize } from '../../src/lib/admin/format';
import { ORDER_STATUS_META, statusMeta } from '../../src/lib/admin/statusRegistry';

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');

test('money in fr-FR with the tenant currency, dash when unknown', () => {
  expect(nbsp(formatMoney(27.11))).toBe('27,11 €');
  expect(nbsp(formatMoney(1027.1))).toBe('1 027,10 €');
  expect(formatMoney(null)).toBe('—');
  expect(formatMoney(Number.NaN)).toBe('—');
});

test('weights switch to kg from 1000 g', () => {
  expect(nbsp(formatWeight(850))).toBe('850 g');
  expect(nbsp(formatWeight(2100))).toBe('2,1 kg');
  expect(formatWeight(undefined)).toBe('—');
});

test('dates render in the shop timezone, identical on server and client', () => {
  expect(formatDate('2026-09-14T17:04:00Z')).toBe('14/09/2026');
  expect(formatDate('2026-09-14T17:04:00Z', 'datetime')).toBe('14/09/2026 19:04');
  expect(formatDate('2026-09-14T17:04:00Z', 'short')).toBe('14/09 19:04');
  expect(formatDate('not a date')).toBe('—');
});

test('relative times are coarse and in French', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  expect(formatRelative('2026-10-10T11:57:00Z', now)).toBe('il y a 3 min');
  expect(formatRelative('2026-10-10T09:00:00Z', now)).toBe('il y a 3 h');
  expect(formatRelative('2026-09-15T12:00:00Z', now)).toBe('il y a 25 j');
  expect(formatRelative('2026-10-10T12:30:00Z', now)).toBe('dans 30 min');
});

test('pluralize', () => {
  expect(pluralize(1, 'commande')).toBe('1 commande');
  expect(pluralize(3, 'commande')).toBe('3 commandes');
  expect(pluralize(2, 'colis', 'colis')).toBe('2 colis');
});

test('status registry: known states keep their label, unknown states stay readable and neutral', () => {
  expect(statusMeta(ORDER_STATUS_META, 'preparing')).toEqual({ label: 'En préparation', tone: 'warning' });
  expect(statusMeta(ORDER_STATUS_META, 'stock_conflict').tone).toBe('danger');
  expect(statusMeta(ORDER_STATUS_META, 'mystery')).toEqual({ label: 'mystery', tone: 'neutral' });
  expect(statusMeta(ORDER_STATUS_META, null)).toEqual({ label: '—', tone: 'neutral' });
});
