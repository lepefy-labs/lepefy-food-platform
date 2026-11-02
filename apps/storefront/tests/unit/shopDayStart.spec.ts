import { test, expect } from '@playwright/test';
import { shopDayStartIso } from '../../src/lib/time/shopTime';

const CASES: Array<[string, string, string]> = [
  ['inverno, 00:30 Parigi', '2026-11-01T23:30:00Z', '2026-11-01T23:00:00.000Z'],
  ['inverno, 23:59 Parigi', '2026-11-01T22:59:59Z', '2026-10-31T23:00:00.000Z'],
  ['estate, 00:30 Parigi', '2026-07-14T22:30:00Z', '2026-07-14T22:00:00.000Z'],
  ['estate, 23:59 Parigi', '2026-07-14T21:59:59Z', '2026-07-13T22:00:00.000Z'],
  ['cambio ora legale', '2026-03-29T10:00:00Z', '2026-03-28T23:00:00.000Z'],
  ['cambio ora solare', '2026-10-25T10:00:00Z', '2026-10-24T22:00:00.000Z'],
  ['metà giornata', '2026-12-10T11:00:00Z', '2026-12-09T23:00:00.000Z'],
];

test.describe('shopDayStartIso', () => {
  for (const [label, now, expected] of CASES) {
    test(`${label}: ${now}`, () => {
      expect(shopDayStartIso(new Date(now))).toBe(expected);
    });
  }

  test('lancia un Error chiaro con una data non valida', () => {
    expect(() => shopDayStartIso(new Date('invalid'))).toThrow();
  });
});
