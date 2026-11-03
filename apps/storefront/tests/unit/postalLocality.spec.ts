import { expect, test } from '@playwright/test';
import { localityLabel, postalDigitsFromInput, reconcileLocality, sameLocality } from '../../src/lib/address/postalLocality';
import { MAX_LOCALITIES_PER_POSTAL_CODE, buildPostalLookupCities } from '../../src/lib/address/postalLookup';
import { isValidPostalCode, normalizePostalCode } from '../../src/lib/address/addressRules';

const city = (name: string, area: string | null = null) => ({ city: name, area, postalCodes: ['90133'], postalCodeCount: 1 });

test('label keeps the leading zero and the pair as « CAP - Localité »', () => {
  expect(localityLabel('09121', 'Cagliari')).toBe('09121 - Cagliari');
  expect(normalizePostalCode('IT', ' 00144 ')).toBe('00144');
  expect(isValidPostalCode('IT', '0914')).toBe(false);
  expect(isValidPostalCode('IT', '09141')).toBe(true);
});

test('typing digits: label text and non digits are reduced to the code, cut at the country length', () => {
  expect(postalDigitsFromInput('90133 - Palermo', 5)).toBe('90133');
  expect(postalDigitsFromInput('0912a1x', 5)).toBe('09121');
  expect(postalDigitsFromInput('123456', 5)).toBe('12345');
  expect(postalDigitsFromInput('1000', 4)).toBe('1000');
});

test('same locality ignores case and accents (variants, saved addresses)', () => {
  expect(sameLocality('Forlì', 'forli')).toBe(true);
  expect(sameLocality("Reggio nell'Emilia", 'Reggio Emilia')).toBe(false);
});

test('reconcile: nothing is ever chosen for the customer, even with a single answer', () => {
  expect(reconcileLocality([city('Palermo')], '')).toEqual({ kind: 'keep' });
  expect(reconcileLocality([city('Palermo')], 'Palermo')).toEqual({ kind: 'keep' });
  expect(reconcileLocality([city('Roma'), city('Ostia')], '')).toEqual({ kind: 'keep' });
  expect(reconcileLocality([city('Roma'), city('Ostia')], 'ostia')).toEqual({ kind: 'keep' });
});

test('reconcile: an incoherent saved pair is cleared, no answer keeps the manual path untouched', () => {
  expect(reconcileLocality([city('Palermo')], 'Catania')).toEqual({ kind: 'clear' });
  expect(reconcileLocality([city('Roma'), city('Ostia')], 'Milano')).toEqual({ kind: 'clear' });
  expect(reconcileLocality([], 'Palermo')).toEqual({ kind: 'keep' });
  expect(reconcileLocality([], '')).toEqual({ kind: 'keep' });
});

test('a complete postal code lists every locality, same-name localities stay separate, order is stable', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    place_name: `Località ${String(i).padStart(2, '0')}`, admin_name1: 'Lazio', admin_code1: 'LAZ', admin_name2: 'Roma', admin_code2: 'RM', postal_code: '00132',
  }));
  const all = buildPostalLookupCities(rows, 'IT', '', MAX_LOCALITIES_PER_POSTAL_CODE);
  expect(all).toHaveLength(25);
  expect(all.map((entry) => entry.city)).toEqual([...all.map((entry) => entry.city)].sort((a, b) => a.localeCompare(b, 'fr')));
  expect(buildPostalLookupCities(rows, 'IT')).toHaveLength(8);
  const homonyms = buildPostalLookupCities([
    { place_name: 'Castro', admin_name1: 'Puglia', admin_code1: 'PUG', admin_name2: 'Lecce', admin_code2: 'LE', postal_code: '73030' },
    { place_name: 'Castro', admin_name1: 'Lombardia', admin_code1: 'LOM', admin_name2: 'Bergamo', admin_code2: 'BG', postal_code: '73030' },
  ], 'IT', '', MAX_LOCALITIES_PER_POSTAL_CODE);
  expect(homonyms).toHaveLength(2);
  expect(new Set(homonyms.map((entry) => entry.area)).size).toBe(2);
});
