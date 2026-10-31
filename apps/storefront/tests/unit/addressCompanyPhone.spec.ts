import { test, expect } from '@playwright/test';
import {
  draftToShippingAddress,
  normalizeShippingAddress,
  shippingAddressToDraft,
  validateAddressDraft,
  ADDRESS_FIELD_ORDER,
} from '../../src/lib/address/addressRules';
import { countryDisplayName, dialCode, filterCountries, flagSrc, phoneCountries } from '../../src/lib/address/countries';
import { normalizePhoneForStorage, parseStoredPhone, readPastedInternational, toE164Phone } from '../../src/lib/phone/internationalPhone';
import { buildPacklinkDraftPayload, type PacklinkWarehouse } from '../../src/lib/shipping/providers/packlink';
import { isMissingCompanyColumn } from '../../src/lib/customers/addressCompany';
import { orderContactPhone } from '../../src/lib/shipping/shipmentDraft/buildDraftInput';

const base = { country: 'IT', street: 'Via Roma', houseNumber: '25', postalCode: '42121', city: 'Reggio Emilia', line2: '' };

test.describe('adresse : entreprise destinataire', () => {
  test('ordre des champs : pays avant code postal, ville, rue, numéro, complément', () => {
    const order = ADDRESS_FIELD_ORDER.filter((f) => !['fullName', 'companyName'].includes(f));
    expect(order).toEqual(['country', 'postalCode', 'city', 'street', 'houseNumber', 'line2']);
  });

  test('entreprise distincte du destinataire, jamais dans line2', () => {
    const stored = draftToShippingAddress({ ...base, deliverToCompany: true, companyName: ' ACME  Srl ' }, 'Marie Kamga');
    expect(stored).toMatchObject({ full_name: 'Marie Kamga', company_name: 'ACME Srl', line1: 'Via Roma 25' });
    expect(stored).not.toHaveProperty('line2');
  });

  test('case décochée : l\'entreprise n\'est pas transmise, la saisie reste dans le brouillon', () => {
    const draft = { ...base, deliverToCompany: false, companyName: 'ACME' };
    expect(draftToShippingAddress(draft, 'Marie')).not.toHaveProperty('company_name');
    expect(validateAddressDraft(draft).companyName).toBeUndefined();
  });

  test('entreprise cochée sans nom : erreur ; trop longue : erreur', () => {
    expect(validateAddressDraft({ ...base, deliverToCompany: true, companyName: ' ' }).companyName).toBeTruthy();
    expect(validateAddressDraft({ ...base, deliverToCompany: true, companyName: 'x'.repeat(81) }).companyName).toBeTruthy();
  });

  test('adresses déjà enregistrées (sans entreprise) restent lisibles, aller-retour avec entreprise', () => {
    const legacy = { full_name: 'Marie', line1: 'Via Roma 25', city: 'Reggio Emilia', postal_code: '42121', country: 'IT' };
    const draft = shippingAddressToDraft(legacy);
    expect(draft).not.toHaveProperty('deliverToCompany');
    const withCompany = shippingAddressToDraft({ ...legacy, company_name: 'ACME' });
    expect(withCompany).toMatchObject({ deliverToCompany: true, companyName: 'ACME' });
  });

  test('serveur : company_name conservé, nettoyé et borné', () => {
    const ok = normalizeShippingAddress({ full_name: 'Marie', company_name: '  ACME \n Srl ', line1: 'Via Roma 25', city: 'Reggio Emilia', postal_code: '42121', country: 'it' });
    expect(ok).toMatchObject({ ok: true, address: { company_name: 'ACME Srl' } });
    const tooLong = normalizeShippingAddress({ full_name: 'Marie', company_name: 'x'.repeat(81), line1: 'Via Roma 25', city: 'Reggio', postal_code: '42121', country: 'IT' });
    expect(tooLong.ok).toBe(false);
    const without = normalizeShippingAddress({ full_name: 'Marie', line1: 'Via Roma 25', city: 'Reggio', postal_code: '42121', country: 'IT' });
    expect(without.ok && 'company_name' in without.address).toBe(false);
  });
});

test.describe('pays et drapeaux', () => {
  test('drapeau SVG statique, nom localisé, indicatif', () => {
    expect(flagSrc('IT')).toBe('/flags/it.svg');
    expect(countryDisplayName('DE', 'fr')).toBe('Allemagne');
    expect(countryDisplayName('DE', 'en')).toBe('Germany');
    expect(dialCode('FR')).toBe('33');
  });

  test('recherche par nom (sans accents) et par indicatif', () => {
    const list = phoneCountries('fr');
    expect(filterCountries(list, 'alle').map((c) => c.code)).toContain('DE');
    expect(filterCountries(list, '+39', true).map((c) => c.code)).toContain('IT');
    expect(filterCountries(list, '33', true).map((c) => c.code)).toContain('FR');
    expect(filterCountries(list, 'zzzz')).toEqual([]);
  });
});

test.describe('téléphone international', () => {
  test('préfixe différent du pays de livraison', () => {
    expect(toE164Phone('6 12 34 56 78', 'FR')).toBe('+33612345678');
    expect(toE164Phone('351 234 5678', 'IT')).toBe('+393512345678');
    expect(toE164Phone('12', 'IT')).toBeNull();
  });

  test('numéro international collé avec + ou 00', () => {
    expect(readPastedInternational('+33 6 12 34 56 78')?.country).toBe('FR');
    expect(readPastedInternational('0033612345678')?.country).toBe('FR');
    expect(readPastedInternational('0612345678')).toBeNull();
  });

  test('numéros déjà enregistrés : E.164, ancien format, illisible conservé', () => {
    expect(parseStoredPhone('+393512345678', 'FR')).toMatchObject({ country: 'IT', e164: '+393512345678' });
    expect(parseStoredPhone('351 234 5678', 'IT').e164).toBe('+393512345678');
    expect(normalizePhoneForStorage('abc 12', 'IT')).toEqual({ value: 'abc 12', e164: null });
    expect(normalizePhoneForStorage(' +39 351 234 5678 ', 'FR').value).toBe('+393512345678');
    expect(normalizePhoneForStorage(null, 'IT')).toEqual({ value: null, e164: null });
  });

  test('téléphone de commande : structuré d\'abord, notes en repli pour les anciennes commandes', () => {
    expect(orderContactPhone('Téléphone: 351 234 5678', { phone: '+393512345678' })).toBe('+393512345678');
    expect(orderContactPhone('Téléphone: 351 234 5678', {})).toBe('351 234 5678');
    expect(orderContactPhone(null, null)).toBeNull();
  });
});

test.describe('payload Packlink', () => {
  const from: PacklinkWarehouse = {
    id: 'w1', name: 'Boutique', surname: null, company: 'Chloe Food', street1: 'Via X 1', street2: null,
    zip_code: '42121', city: 'Reggio Emilia', country: 'IT', phone: '+390000000', email: null,
  };
  const input = (company: string | null) => ({
    orderReference: 'LEPEFY-ABC',
    recipient: {
      firstName: 'Marie', lastName: 'Kamga', company, street1: 'Rue Neuve 25', street2: null,
      postalCode: '1000', city: 'Bruxelles', country: 'BE', phone: '+32470123456', email: null,
    },
    parcels: [{ weightKg: 2, lengthCm: 30, widthCm: 20, heightCm: 10 }],
    content: 'Alimentation', contentValue: 20, currency: 'EUR',
  });
  const locations = {
    from: null,
    to: { zipCodeId: 'z1', postalZoneId: '111', postalZoneName: 'Belgique' },
  };

  test('avec entreprise : to.company distinct de name/surname', () => {
    const payload = buildPacklinkDraftPayload(from, input('ACME SA'), locations) as { to: Record<string, unknown> };
    expect(payload.to).toMatchObject({ name: 'Marie', surname: 'Kamga', company: 'ACME SA', zip_code: '1000', phone: '+32470123456' });
  });

  test('sans entreprise : pas de clé company', () => {
    const payload = buildPacklinkDraftPayload(from, input(null), locations) as { to: Record<string, unknown> };
    expect(payload.to).not.toHaveProperty('company');
  });

  test('la résolution du code postal Packlink est conservée', () => {
    const payload = buildPacklinkDraftPayload(from, input('ACME'), locations) as { additional_data: Record<string, unknown> };
    expect(payload.additional_data).toMatchObject({ zip_code_id_to: 'z1', postal_zone_id_to: '111' });
  });
});

test('migration 177 : colonne absente reconnue, autres erreurs non', () => {
  expect(isMissingCompanyColumn({ code: '42703', message: 'column does not exist' })).toBe(true);
  expect(isMissingCompanyColumn({ code: 'PGRST204', message: 'x' })).toBe(true);
  expect(isMissingCompanyColumn({ code: '23505', message: 'duplicate key' })).toBe(false);
  expect(isMissingCompanyColumn(null)).toBe(false);
});
