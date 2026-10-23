import { test, expect } from '@playwright/test';
import { chooseEstimateCountry } from '../../src/lib/shipping/tariff/estimateCountry';
import { createMemoryRateLimiter } from '../../src/lib/http/memoryRateLimit';

const active = ['IT', 'FR'];

test('country order: checkout address, then explicit choice, account, IP, shop default', () => {
  const all = {
    activeCountries: active,
    address: { country: 'fr', postalCode: '75011' },
    chosenCountry: 'IT',
    account: { country: 'IT', postalCode: '82100' },
    ipCountry: 'IT',
    defaultCountry: 'IT',
  };
  expect(chooseEstimateCountry(all)).toEqual({ country: 'FR', postalCode: '75011', source: 'address' });
  expect(chooseEstimateCountry({ ...all, address: null, chosenCountry: 'FR' })).toEqual({ country: 'FR', postalCode: null, source: 'chosen' });
  expect(chooseEstimateCountry({ ...all, address: null, chosenCountry: null })).toEqual({ country: 'IT', postalCode: '82100', source: 'account' });
  expect(chooseEstimateCountry({ ...all, address: null, chosenCountry: null, account: null, ipCountry: 'FR' })).toEqual({ country: 'FR', postalCode: null, source: 'ip' });
  expect(chooseEstimateCountry({ activeCountries: active, defaultCountry: 'IT' })).toEqual({ country: 'IT', postalCode: null, source: 'default' });
});

test('a country without an active tariff is skipped, never priced; nothing served = no estimate', () => {
  // Visitor in Germany (no tariff): the shop default is used, labelled as such.
  expect(chooseEstimateCountry({ activeCountries: ['IT'], ipCountry: 'DE', defaultCountry: 'IT' })?.source).toBe('default');
  // Saved address abroad without tariff: falls through to the next served source.
  expect(chooseEstimateCountry({ activeCountries: ['IT'], account: { country: 'BE', postalCode: '1000' }, defaultCountry: 'IT' }))
    .toEqual({ country: 'IT', postalCode: null, source: 'default' });
  expect(chooseEstimateCountry({ activeCountries: [], defaultCountry: 'IT' })).toBeNull();
  expect(chooseEstimateCountry({ activeCountries: ['FR'], defaultCountry: 'IT' })).toBeNull();
});

test('in-memory limiter: limit per key inside the window, then free again', () => {
  const allow = createMemoryRateLimiter({ limit: 2, windowMs: 1000 });
  expect([allow('a', 0), allow('a', 10), allow('a', 20), allow('b', 20)]).toEqual([true, true, false, true]);
  expect(allow('a', 1011)).toBe(true);
});
