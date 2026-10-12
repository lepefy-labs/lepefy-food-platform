import { test, expect } from '@playwright/test';
import {
  deliveryZoneKind,
  findDeliveryZoneConflict,
  matchedPostalPrefix,
  normalizeDeliveryCountries,
  normalizeDeliveryZone,
  parsePostalPrefixes,
  type ExistingDeliveryZone,
} from '../../src/lib/rental/deliveryZoneRules';
import { normalizeAddressParts } from '../../src/lib/address/addressRules';

const base = { label: 'Reggio Emilia centre', country: 'it', fee_amount: '12,5' };

test.describe('zone de livraison : contrôle', () => {
  test('codes postaux : nettoyés, sans doublons, ville retirée', () => {
    const result = normalizeDeliveryZone({ ...base, kind: 'postal', postal_code_prefixes: ' 421, 422 421;423 ', city: 'Reggio Emilia' });
    expect(result).toEqual({
      ok: true,
      kind: 'postal',
      zone: { label: 'Reggio Emilia centre', country: 'IT', postal_code_prefixes: ['421', '422', '423'], city: null, fee_amount: 12.5, note: null, active: true },
    });
  });

  test('codes postaux : chiffres et longueur selon le pays', () => {
    const letters = normalizeDeliveryZone({ ...base, kind: 'postal', postal_code_prefixes: '421, 4221A' });
    expect(letters).toMatchObject({ ok: false, field: 'postal_code_prefixes' });
    expect(!letters.ok && letters.error).toContain('5 au maximum');
    expect(normalizeDeliveryZone({ ...base, kind: 'postal', postal_code_prefixes: '421000' })).toMatchObject({ ok: false, field: 'postal_code_prefixes' });
    expect(normalizeDeliveryZone({ ...base, country: 'BE', kind: 'postal', postal_code_prefixes: '10000' })).toMatchObject({ ok: false, field: 'postal_code_prefixes' });
    expect(normalizeDeliveryZone({ ...base, country: 'BE', kind: 'postal', postal_code_prefixes: '1000' }).ok).toBe(true);
    expect(normalizeDeliveryZone({ ...base, kind: 'postal', postal_code_prefixes: '' })).toMatchObject({ ok: false, field: 'postal_code_prefixes' });
    // Pays hors liste standard : lettres et chiffres acceptés.
    expect(normalizeDeliveryZone({ ...base, country: 'GB', kind: 'postal', postal_code_prefixes: 'sw1' })).toMatchObject({ ok: true, zone: { postal_code_prefixes: ['SW1'] } });
  });

  test('ville : obligatoire, codes postaux retirés', () => {
    expect(normalizeDeliveryZone({ ...base, kind: 'city', city: '  ' })).toMatchObject({ ok: false, field: 'city' });
    expect(normalizeDeliveryZone({ ...base, kind: 'city', city: ' Modena ', postal_code_prefixes: ['411'] }))
      .toMatchObject({ ok: true, kind: 'city', zone: { city: 'Modena', postal_code_prefixes: null } });
  });

  test('tout le pays : ni code postal ni ville', () => {
    expect(normalizeDeliveryZone({ ...base, kind: 'country', city: 'Modena', postal_code_prefixes: ['411'] }))
      .toMatchObject({ ok: true, kind: 'country', zone: { city: null, postal_code_prefixes: null } });
  });

  test('type déduit des champs quand il manque (anciennes requêtes)', () => {
    expect(normalizeDeliveryZone({ ...base, postal_code_prefixes: ['421'], city: 'Reggio' })).toMatchObject({ ok: true, kind: 'postal' });
    expect(normalizeDeliveryZone({ ...base, city: 'Reggio' })).toMatchObject({ ok: true, kind: 'city' });
    expect(normalizeDeliveryZone({ ...base })).toMatchObject({ ok: true, kind: 'country' });
  });

  test('nom, pays et supplément obligatoires et valides', () => {
    expect(normalizeDeliveryZone({ ...base, label: ' ' })).toMatchObject({ ok: false, field: 'label' });
    expect(normalizeDeliveryZone({ ...base, country: '' })).toMatchObject({ ok: false, field: 'country' });
    expect(normalizeDeliveryZone({ ...base, country: 'Italie' })).toMatchObject({ ok: false, field: 'country' });
    expect(normalizeDeliveryZone({ ...base, fee_amount: -1 })).toMatchObject({ ok: false, field: 'fee_amount' });
    expect(normalizeDeliveryZone({ ...base, fee_amount: '' })).toMatchObject({ ok: false, field: 'fee_amount' });
    expect(normalizeDeliveryZone({ ...base, fee_amount: 0 })).toMatchObject({ ok: true, zone: { fee_amount: 0 } });
    expect(normalizeDeliveryZone({ ...base, fee_amount: 9.999 })).toMatchObject({ ok: true, zone: { fee_amount: 10 } });
    expect(normalizeDeliveryZone({ ...base, active: false })).toMatchObject({ ok: true, zone: { active: false } });
  });
});

test.describe('zone de livraison : doublons', () => {
  const zone = (id: string, fields: Partial<ExistingDeliveryZone>): ExistingDeliveryZone => ({
    id, label: id, country: 'IT', postal_code_prefixes: null, city: null, active: true, ...fields,
  });
  const existing = [
    zone('cp', { postal_code_prefixes: ['421', '422'] }),
    zone('ville', { city: "Reggio nell'Emilia" }),
    zone('pays', {}),
    zone('inactive', { postal_code_prefixes: ['411'], active: false }),
    zone('france', { country: 'FR', postal_code_prefixes: ['75'] }),
  ];
  const check = (raw: Record<string, unknown>, selfId?: string) => {
    const result = normalizeDeliveryZone({ label: 'Nouvelle', country: 'IT', fee_amount: 10, ...raw });
    if (!result.ok) throw new Error(result.error);
    return findDeliveryZoneConflict(result.zone, existing, selfId);
  };

  test('même début de code postal, même ville, deuxième zone pays', () => {
    expect(check({ kind: 'postal', postal_code_prefixes: '423, 422' })).toMatchObject({ field: 'postal_code_prefixes' });
    expect(check({ kind: 'city', city: 'reggio emilia' })).toMatchObject({ field: 'city' });
    expect(check({ kind: 'country' })).toMatchObject({ field: 'kind' });
  });

  test('aucun conflit : autre préfixe, zone inactive, autre pays, elle-même, nouvelle zone inactive', () => {
    expect(check({ kind: 'postal', postal_code_prefixes: '4212' })).toBeNull();
    expect(check({ kind: 'postal', postal_code_prefixes: '411' })).toBeNull();
    expect(check({ kind: 'postal', country: 'FR', postal_code_prefixes: '92' })).toBeNull();
    expect(check({ kind: 'postal', postal_code_prefixes: '421' }, 'cp')).toBeNull();
    expect(check({ kind: 'country', active: false })).toBeNull();
  });
});

test.describe('pays de livraison du tenant', () => {
  test('codes ISO2 en majuscules, sans doublons', () => {
    expect(normalizeDeliveryCountries([' it', 'FR', 'IT'])).toEqual({ ok: true, countries: ['IT', 'FR'] });
    expect(normalizeDeliveryCountries([])).toEqual({ ok: true, countries: [] });
  });

  test('saisie invalide refusée', () => {
    expect(normalizeDeliveryCountries(['Italie'])).toMatchObject({ ok: false });
    expect(normalizeDeliveryCountries(['ITA'])).toMatchObject({ ok: false });
    expect(normalizeDeliveryCountries('IT')).toMatchObject({ ok: false });
  });
});

test.describe('aides', () => {
  test('type d’une zone enregistrée et préfixe trouvé', () => {
    expect(deliveryZoneKind({ postal_code_prefixes: ['421'], city: 'Reggio' })).toBe('postal');
    expect(deliveryZoneKind({ postal_code_prefixes: [], city: 'Reggio' })).toBe('city');
    expect(deliveryZoneKind({ postal_code_prefixes: null, city: null })).toBe('country');
    expect(matchedPostalPrefix({ postal_code_prefixes: ['42', '421'], city: null }, '42 121')).toBe('421');
    expect(matchedPostalPrefix({ postal_code_prefixes: ['41'], city: null }, '42121')).toBeNull();
    expect(parsePostalPrefixes(['421 422', 'a1'])).toEqual(['421', '422', 'A1']);
  });

  test('conversion retrait → livraison : pays en texte refusé, adresse nettoyée', () => {
    expect(normalizeAddressParts({ street: 'Via Roma', houseNumber: '25', postalCode: '42121', city: 'Reggio Emilia', country: 'Italie' }))
      .toMatchObject({ ok: false, field: 'country' });
    expect(normalizeAddressParts({ street: ' Via  Roma ', houseNumber: '25', postalCode: ' 42 121', city: 'Reggio Emilia ', country: 'it' }))
      .toEqual({ ok: true, address: { street: 'Via Roma', houseNumber: '25', postalCode: '42121', city: 'Reggio Emilia', country: 'IT' } });
  });
});
