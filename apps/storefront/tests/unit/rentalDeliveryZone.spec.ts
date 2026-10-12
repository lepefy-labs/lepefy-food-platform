import { test, expect } from '@playwright/test';
import { isCountryAllowedForDelivery, matchDeliveryZone, normalizeZoneCity } from '../../src/lib/rental/matchDeliveryZone';

const zone = (id: string, fields: { country?: string | null; city?: string | null; prefixes?: string[] | null; fee?: number }) => ({
  id,
  country: fields.country ?? null,
  city: fields.city ?? null,
  postal_code_prefixes: fields.prefixes ?? null,
  fee_amount: fields.fee ?? 10,
});

test.describe('nom de ville comparable', () => {
  test('casse, accents, ponctuation et mots de liaison ignorés', () => {
    expect(normalizeZoneCity("Reggio nell'Emilia")).toBe('reggio emilia');
    expect(normalizeZoneCity('Reggio Emilia')).toBe('reggio emilia');
    expect(normalizeZoneCity('Reggio di Calabria')).toBe(normalizeZoneCity('Reggio Calabria'));
    expect(normalizeZoneCity('Saint-Étienne')).toBe(normalizeZoneCity('saint etienne'));
    expect(normalizeZoneCity('  Bruxelles  ')).toBe('bruxelles');
    expect(normalizeZoneCity('Frankfurt am Main')).toBe(normalizeZoneCity('Frankfurt Main'));
    expect(normalizeZoneCity('Saint-Rémy-lès-Chevreuse')).toBe('saint remy chevreuse');
  });

  test('nom fait uniquement de mots de liaison : conservé', () => {
    expect(normalizeZoneCity('La')).toBe('la');
  });

  test('villes différentes restent différentes', () => {
    expect(normalizeZoneCity('Modena')).not.toBe(normalizeZoneCity('Reggio Emilia'));
    expect(normalizeZoneCity('Reggio Emilia')).not.toBe(normalizeZoneCity('Reggio Calabria'));
    expect(normalizeZoneCity('Saint-Denis')).not.toBe(normalizeZoneCity('Denis'));
  });
});

test.describe('choix de la zone de livraison (location)', () => {
  const zones = [
    zone('pays', { country: 'IT', fee: 30 }),
    zone('ville', { country: 'IT', city: 'Reggio Emilia', fee: 15 }),
    zone('cp-court', { country: 'IT', prefixes: ['42'], fee: 20 }),
    zone('cp-long', { country: 'IT', prefixes: ['421'], fee: 12 }),
    zone('france', { country: 'fr', city: 'Saint-Étienne', fee: 25 }),
  ];

  test('préfixe CP le plus long d\'abord, CP comparé sans espaces', () => {
    expect(matchDeliveryZone(zones, { country: 'it', postal_code: '42 121', city: 'X' })?.id).toBe('cp-long');
    expect(matchDeliveryZone(zones, { country: 'IT', postal_code: '42046', city: 'Reggiolo' })?.id).toBe('cp-court');
    const spaced = [zone('espace', { country: 'IT', prefixes: [' 41 1 '] })];
    expect(matchDeliveryZone(spaced, { country: 'IT', postal_code: '41121', city: 'Modena' })?.id).toBe('espace');
  });

  test('même ville malgré les variantes d\'écriture', () => {
    const noPrefix = zones.filter((entry) => !entry.postal_code_prefixes);
    expect(matchDeliveryZone(noPrefix, { country: 'IT', postal_code: '42121', city: "Reggio nell'Emilia" })?.id).toBe('ville');
    expect(matchDeliveryZone(noPrefix, { country: 'FR', postal_code: '42000', city: 'saint etienne' })?.id).toBe('france');
  });

  test('ville inconnue : zone pays, sinon aucune zone', () => {
    const noPrefix = zones.filter((entry) => !entry.postal_code_prefixes);
    expect(matchDeliveryZone(noPrefix, { country: 'IT', postal_code: '41121', city: 'Modena' })?.id).toBe('pays');
    expect(matchDeliveryZone(noPrefix.filter((entry) => entry.id !== 'pays'), { country: 'IT', postal_code: '41121', city: 'Modena' })).toBeNull();
    // Ville vide : jamais rapprochée d'une zone ville.
    expect(matchDeliveryZone([zone('ville', { country: 'IT', city: 'Reggio Emilia' })], { country: 'IT', postal_code: '42121', city: ' ' })).toBeNull();
  });

  test('autre pays : aucune zone du pays voisin', () => {
    expect(matchDeliveryZone(zones, { country: 'DE', postal_code: '42121', city: 'Reggio Emilia' })).toBeNull();
  });

  test('pays autorisés du tenant', () => {
    const tenant = { rental_delivery_enabled: true, rental_delivery_countries: ['IT'] };
    expect(isCountryAllowedForDelivery(tenant, 'it')).toBe(true);
    expect(isCountryAllowedForDelivery(tenant, 'FR')).toBe(false);
    expect(isCountryAllowedForDelivery({ ...tenant, rental_delivery_enabled: false }, 'IT')).toBe(false);
  });
});
