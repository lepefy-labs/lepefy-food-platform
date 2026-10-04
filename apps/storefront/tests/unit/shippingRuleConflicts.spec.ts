import { expect, test } from '@playwright/test';
import type { ShippingZoneRow } from '@lepefy/types';
import { applyCountryRule } from '../../src/lib/shipping/resolveCountryRule';
import { resolveZoneCodeFromRows } from '../../src/lib/shipping/intelligence/resolveZone';
import {
  duplicatePrefixes,
  explainZoneMatch,
  findCountryRuleConflicts,
  findZonePrefixConflicts,
  groupZonesByCountry,
  overlapMessage,
  overlappingCountries,
  previewCountryRule,
} from '../../src/lib/shipping/shippingRuleConflicts';

const rule = (id: string, countries: string[], active = true) => ({ id, countries, active });

test.describe('country rule conflicts', () => {
  test('a country in two active rules is a conflict', () => {
    const conflicts = findCountryRuleConflicts([rule('a', ['FR']), rule('b', ['BE', 'FR']), rule('c', ['IT'])]);
    expect(conflicts).toEqual([{ country: 'FR', ruleIds: ['a', 'b'] }]);
  });

  test('inactive rules and the * fallback never conflict', () => {
    expect(findCountryRuleConflicts([rule('a', ['FR']), rule('b', ['FR'], false), rule('c', ['*'])])).toEqual([]);
  });

  test('a candidate overlapping another active rule is reported (create, edit, re-activate)', () => {
    const existing = [rule('a', ['FR']), rule('b', ['IT'], false), rule('c', ['*'])];
    expect(overlappingCountries({ countries: ['BE', 'FR'], active: true }, existing)).toEqual(['FR']);
    expect(overlappingCountries({ countries: ['IT'], active: true }, existing)).toEqual([]);
    expect(overlappingCountries({ id: 'a', countries: ['FR'], active: true }, existing)).toEqual([]);
    expect(overlappingCountries({ countries: ['FR'], active: false }, existing)).toEqual([]);
    expect(overlappingCountries({ countries: ['*'], active: true }, existing)).toEqual([]);
  });

  test('overlap message names the countries', () => {
    expect(overlapMessage(['FR'])).toContain('France est déjà couvert');
    expect(overlapMessage(['BE', 'FR'])).toContain('Belgique, France sont déjà couverts');
  });
});

test('preview is exactly the quote computation', () => {
  const r = { countries: ['IT'], free_shipping_above: 80, flat_rate_override: null, discount_type: 'percentage' as const, discount_value: 10 };
  expect(previewCountryRule(12.9, 45, r)).toEqual(applyCountryRule(12.9, 45, r));
  expect(previewCountryRule(12.9, 45, r).finalCost).toBe(11.61);
  expect(previewCountryRule(12.9, 80, r).freeShippingApplied).toBe(true);
  const flat = { ...r, flat_rate_override: 5, discount_type: null, discount_value: null, free_shipping_above: null };
  expect(previewCountryRule(12.9, 45, flat).finalCost).toBe(5);
});

function zone(id: string, code: string, country: string, prefixes: string[], active = true, position = 0): ShippingZoneRow {
  return { id, tenant_id: 't', code, country, postal_prefixes: prefixes, active, position, created_at: '', updated_at: '' };
}

test.describe('zones', () => {
  const zones = [
    zone('1', 'IT_VENETO', 'IT', ['30', '31']),
    zone('2', 'IT_VENICE_LAGOON', 'IT', ['30121', '30122']),
    zone('3', 'IT_SICILY', 'IT', ['90', '91']),
    zone('4', 'FR_MAINLAND', 'FR', ['30', '75']),
  ];

  test('explains the longest-prefix match like resolveZoneCodeFromRows', () => {
    const match = explainZoneMatch(zones, 'it', '30121');
    expect(match).toEqual({ zoneCode: 'IT_VENICE_LAGOON', matchedPrefix: '30121', overridden: [{ zoneCode: 'IT_VENETO', prefix: '30' }] });
    const cases: Array<[string, string]> = [['IT', '30121'], ['IT', '30170'], ['IT', '90100'], ['FR', '30000'], ['IT', '10100'], ['DE', '10115']];
    for (const [country, postal] of cases) {
      expect(explainZoneMatch(zones, country, postal).zoneCode, `${country} ${postal}`).toBe(resolveZoneCodeFromRows(zones, country, postal));
    }
  });

  test('no zone and inactive zones', () => {
    expect(explainZoneMatch(zones, 'IT', '10100').zoneCode).toBeNull();
    expect(explainZoneMatch([zone('1', 'IT_X', 'IT', ['10'], false)], 'IT', '10100').zoneCode).toBeNull();
    expect(explainZoneMatch(zones, 'IT', '  ').zoneCode).toBeNull();
  });

  test('identical prefix in two active zones of one country is ambiguous; nested prefixes are not', () => {
    expect(findZonePrefixConflicts(zones)).toEqual([]);
    const clash = [...zones, zone('5', 'IT_OTHER', 'IT', ['90']), zone('6', 'IT_OFF', 'IT', ['91'], false)];
    expect(findZonePrefixConflicts(clash)).toEqual([{ country: 'IT', prefix: '90', zoneCodes: ['IT_OTHER', 'IT_SICILY'] }]);
  });

  test('duplicatePrefixes checks the candidate against other active zones of the same country', () => {
    expect(duplicatePrefixes({ country: 'IT', postal_prefixes: ['90', '12'], active: true }, zones)).toEqual(['90']);
    expect(duplicatePrefixes({ id: '3', country: 'IT', postal_prefixes: ['90'], active: true }, zones)).toEqual([]);
    expect(duplicatePrefixes({ country: 'DE', postal_prefixes: ['30'], active: true }, zones)).toEqual([]);
    expect(duplicatePrefixes({ country: 'IT', postal_prefixes: ['90'], active: false }, zones)).toEqual([]);
  });

  test('groups by country in first-seen order', () => {
    expect(groupZonesByCountry(zones).map((g) => [g.country, g.zones.length])).toEqual([['IT', 3], ['FR', 1]]);
  });
});
