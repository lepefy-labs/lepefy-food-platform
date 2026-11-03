import { expect, test } from '@playwright/test';
import { FakeDb } from './helpers/fakeShippingSupabase';
import {
  defaultGeoPolicy, destinationCountryList, evaluateStorageRestrictions, geoPolicyFromRow, geoPolicyStamp,
  isDestinationAllowed, parseGeoPolicyInput, EU_COUNTRIES,
  type GeoPolicy,
} from '../../src/lib/shipping/geo/geoPolicy';
import { checkDeliveryGeo } from '../../src/lib/shipping/geo/geoPolicyServer';
import { calculateShipping, hasExplicitVatRate } from '../../src/lib/shipping/calculateShipping';
import {
  cartFingerprint, signQuoteV2, verifyQuoteV2,
} from '../../src/lib/shipping/quoteToken';
import {
  providerFallbackAllowed, revalidateSessionShipping, verifyCheckoutShipping, SHIPPING_REQUOTE_REQUIRED,
} from '../../src/lib/shipping/tariff/checkoutShipping';
import {
  isValidPostalCode, normalizePostalCode, normalizeShippingAddress, postalCodeRequired, validateAddressDraft,
} from '../../src/lib/address/addressRules';

const SECRET = 'test-secret';
const T1 = 'tenant-a';
const T2 = 'tenant-b';

function policyRow(over: Record<string, unknown> = {}) {
  return {
    tenant_id: T1, destination_mode: 'current', included_countries: [], excluded_countries: [],
    provider_fallback_enabled: false, policy_version: 1,
    storage_rules: {
      dry: { mode: 'none', countries: [] }, fresh: { mode: 'none', countries: [] }, frozen: { mode: 'none', countries: [] },
    },
    ...over,
  };
}

const PRODUCTS = [
  { id: 'riz', tenant_id: T1, name: 'Riz', active: true, storage_type: 'dry', weight_grams: 1000, price: 3 },
  { id: 'poisson', tenant_id: T1, name: 'Poisson frais', active: true, storage_type: 'fresh', weight_grams: 500, price: 9 },
  { id: 'glace', tenant_id: T1, name: 'Glace', active: true, storage_type: 'frozen', weight_grams: 500, price: 5 },
  { id: 'mystere', tenant_id: T1, name: 'Mystère', active: true, storage_type: null, weight_grams: 500, price: 5 },
  { id: 'riz', tenant_id: T2, name: 'Riz B', active: true, storage_type: 'dry', weight_grams: 1000, price: 3 },
];

const db = (policy: Record<string, unknown>[] = []) =>
  new FakeDb({ tenant_shipping_geo_policy: policy, products: PRODUCTS, shipping_tariff_versions: [] });

const cart = (...ids: string[]) => new Map(ids.map((id) => [id, 1]));

const storage = (patch: Record<string, unknown>) => ({
  dry: { mode: 'none', countries: [] }, fresh: { mode: 'none', countries: [] }, frozen: { mode: 'none', countries: [] }, ...patch,
});

test.describe('destinations', () => {
  const base = defaultGeoPolicy();
  test('mode actuel: pays historiques + forfaits actifs', () => {
    expect(isDestinationAllowed(base, 'IT', []).allowed).toBe(true);
    expect(isDestinationAllowed(base, 'NL', []).allowed).toBe(false);
    expect(isDestinationAllowed(base, 'NL', ['NL']).allowed).toBe(true);
  });
  test('UE, tous transporteur, liste personnalisée, exclusions', () => {
    expect(isDestinationAllowed({ ...base, destinationMode: 'eu' }, 'ES', []).allowed).toBe(true);
    expect(isDestinationAllowed({ ...base, destinationMode: 'eu' }, 'GB', []).allowed).toBe(false);
    expect(isDestinationAllowed({ ...base, destinationMode: 'carrier_all' }, 'US', []).allowed).toBe(true);
    const custom = { ...base, destinationMode: 'custom' as const, includedCountries: ['GB'] };
    expect(isDestinationAllowed(custom, 'GB', []).allowed).toBe(true);
    expect(isDestinationAllowed(custom, 'FR', []).allowed).toBe(false);
    const excluded = { ...base, destinationMode: 'carrier_all' as const, excludedCountries: ['US'] };
    expect(isDestinationAllowed(excluded, 'US', [])).toEqual({ allowed: false, reason: 'excluded' });
    expect(isDestinationAllowed(excluded, 'XXX', []).allowed).toBe(false);
  });
  test('liste des pays proposés au checkout', () => {
    expect(destinationCountryList({ ...base, destinationMode: 'eu', excludedCountries: ['FR'] }, [], ['IT', 'FR', 'US'])).toEqual(['IT']);
    expect(EU_COUNTRIES).toHaveLength(27);
  });
});

test.describe('restrictions par conservation', () => {
  const eval_ = (rules: Record<string, unknown>, country: string, ids: string[]) =>
    evaluateStorageRestrictions(geoPolicyFromRow(policyRow({ storage_rules: storage(rules) })), country, 'IT',
      ids.map((id) => ({ id, name: id, storageType: PRODUCTS.find((p) => p.id === id)!.storage_type })));

  test('aucune restriction: tout passe, produit sans classement compris', () => {
    expect(eval_({}, 'US', ['riz', 'poisson', 'glace', 'mystere'])).toEqual({ ok: true });
  });
  test('frais limité à l’Italie (pays du magasin)', () => {
    const rules = { fresh: { mode: 'store_country', countries: [] } };
    expect(eval_(rules, 'IT', ['riz', 'poisson'])).toEqual({ ok: true });
    const blocked = eval_(rules, 'FR', ['riz', 'poisson']);
    expect(blocked).toMatchObject({ ok: false, blocked: [{ id: 'poisson' }] });
  });
  test('surgelé limité à l’UE, liste personnalisée, panier mixte', () => {
    expect(eval_({ frozen: { mode: 'eu', countries: [] } }, 'DE', ['glace'])).toEqual({ ok: true });
    expect(eval_({ frozen: { mode: 'eu', countries: [] } }, 'GB', ['glace']).ok).toBe(false);
    const custom = { fresh: { mode: 'custom', countries: ['CH'] }, frozen: { mode: 'eu', countries: [] } };
    expect(eval_(custom, 'CH', ['poisson', 'riz'])).toEqual({ ok: true });
    const mixed = eval_(custom, 'CH', ['poisson', 'glace', 'riz']);
    expect(mixed).toMatchObject({ ok: false, blocked: [{ id: 'glace' }] });
  });
  test('produit sans classement: bloqué dès qu’une restriction existe, jamais présumé ambiant', () => {
    expect(eval_({ fresh: { mode: 'eu', countries: [] } }, 'FR', ['mystere'])).toMatchObject({ ok: false, blocked: [{ id: 'mystere', storageType: null }] });
  });
  test('liste personnalisée corrompue → refus de tout, jamais ouverture', () => {
    const p = geoPolicyFromRow(policyRow({ storage_rules: storage({ fresh: { mode: 'custom', countries: 'oops' } }) }));
    expect(evaluateStorageRestrictions(p, 'IT', 'IT', [{ id: 'poisson', name: 'P', storageType: 'fresh' }]).ok).toBe(false);
  });
});

test.describe('validation admin', () => {
  const valid = {
    destinationMode: 'custom', includedCountries: ['gb', 'GB', 'US'], excludedCountries: [], providerFallbackEnabled: true,
    storageRules: storage({ fresh: { mode: 'custom', countries: ['IT'] } }),
  };
  test('normalise et accepte', () => {
    const r = parseGeoPolicyInput(valid);
    expect(r.ok && r.value.includedCountries).toEqual(['GB', 'US']);
  });
  test('refuse mode invalide, pays invalides, liste vide', () => {
    expect(parseGeoPolicyInput({ ...valid, destinationMode: 'world' }).ok).toBe(false);
    expect(parseGeoPolicyInput({ ...valid, includedCountries: ['ITA'] }).ok).toBe(false);
    expect(parseGeoPolicyInput({ ...valid, includedCountries: [] }).ok).toBe(false);
    expect(parseGeoPolicyInput({ ...valid, storageRules: storage({ fresh: { mode: 'custom', countries: [] } }) }).ok).toBe(false);
    expect(parseGeoPolicyInput(null).ok).toBe(false);
  });
});

test.describe('checkDeliveryGeo (serveur, base du tenant)', () => {
  test('sans politique: comportement historique, aucune restriction', async () => {
    const r = await checkDeliveryGeo({ supabase: db().client(), tenant: { id: T1, country: 'IT' }, country: 'US', quantityByProduct: cart('poisson') });
    expect(r.ok).toBe(true);
  });
  test('destination hors politique → DESTINATION_NOT_ALLOWED', async () => {
    const d = db([policyRow({ destination_mode: 'eu' })]);
    const r = await checkDeliveryGeo({ supabase: d.client(), tenant: { id: T1, country: 'IT' }, country: 'US', quantityByProduct: cart('riz') });
    expect(r).toMatchObject({ ok: false, code: 'DESTINATION_NOT_ALLOWED' });
  });
  test('conservation: produits concernés listés, classement lu en base', async () => {
    const d = db([policyRow({ destination_mode: 'carrier_all', storage_rules: storage({ fresh: { mode: 'store_country', countries: [] } }) })]);
    const r = await checkDeliveryGeo({ supabase: d.client(), tenant: { id: T1, country: 'IT' }, country: 'FR', quantityByProduct: cart('riz', 'poisson') });
    expect(r).toMatchObject({ ok: false, code: 'STORAGE_RESTRICTED', blockedProducts: [{ id: 'poisson', name: 'Poisson frais' }] });
  });
  test('isolation multi-tenant: la politique et les produits d’un autre tenant ne comptent pas', async () => {
    const d = db([policyRow({ tenant_id: T2, destination_mode: 'custom', included_countries: ['US'] })]);
    const r = await checkDeliveryGeo({ supabase: d.client(), tenant: { id: T1, country: 'IT' }, country: 'FR', quantityByProduct: cart('riz') });
    expect(r.ok).toBe(true); // T1 n'a pas de politique
    const stolen = await checkDeliveryGeo({
      supabase: db([policyRow({ storage_rules: storage({ dry: { mode: 'custom', countries: ['ZZ'] } }) })]).client(),
      tenant: { id: T1, country: 'IT' }, country: 'IT', quantityByProduct: new Map([['inconnu', 1]]),
    });
    expect(stolen).toMatchObject({ ok: false, code: 'STORAGE_RESTRICTED' });
  });
  test('panier sans produit identifiable avec restriction → refus', async () => {
    const d = db([policyRow({ storage_rules: storage({ fresh: { mode: 'eu', countries: [] } }) })]);
    const r = await checkDeliveryGeo({ supabase: d.client(), tenant: { id: T1, country: 'IT' }, country: 'IT', quantityByProduct: new Map() });
    expect(r.ok).toBe(false);
  });
});

test.describe('paiement: le contournement par API est refusé', () => {
  const tenant = { id: T1, country: 'IT', shipping_pricing_mode: 'tariff', shipping_tariff_fallback: 'unavailable', click_collect_enabled: true };
  const restricted = () => db([policyRow({ destination_mode: 'carrier_all', storage_rules: storage({ fresh: { mode: 'store_country', countries: [] } }) })]);

  test('verifyCheckoutShipping refuse un panier restreint même avec un jeton valide', async () => {
    const qty = cart('poisson');
    const token = signQuoteV2({ ten: T1, t: 500, c: 'FR', z: '75011', w: 500, h: cartFingerprint(qty), m: 'provider_cost', tid: null, tv: null, pq: null, av: 'provider_cost_fallback', cr: null, sv: null, gp: 'g1' }, SECRET);
    const r = await verifyCheckoutShipping({
      supabase: restricted().client(), tenant, fulfillmentType: 'delivery', address: { country: 'FR', postal_code: '75011' },
      quoteToken: token, quantityByProduct: qty, subtotal: 9, clientShippingDetails: null, secret: SECRET,
    });
    expect(r).toMatchObject({ ok: false, status: 422, body: { code: 'STORAGE_RESTRICTED', blockedProducts: [{ id: 'poisson' }] } });
  });
  test('revalidation de session: même contrôle', async () => {
    const r = await revalidateSessionShipping({
      supabase: restricted().client(), tenant, fulfillmentType: 'delivery', address: { country: 'FR', postal_code: '75011' },
      shippingDetails: { pricingMode: 'provider_cost_fallback' }, shippingTotal: 5, quantityByProduct: cart('poisson'), subtotal: 9,
    });
    expect(r).toMatchObject({ ok: false, body: { code: 'STORAGE_RESTRICTED' } });
  });
  test('politique modifiée après le devis → nouveau devis exigé', async () => {
    const qty = cart('riz');
    const d = db([policyRow({ destination_mode: 'carrier_all', provider_fallback_enabled: true, policy_version: 2 })]);
    const old = signQuoteV2({ ten: T1, t: 500, c: 'FR', z: '75011', w: 1000, h: cartFingerprint(qty), m: 'provider_cost', tid: null, tv: null, pq: null, av: 'provider_cost_fallback', cr: null, sv: null, gp: 'g1' }, SECRET);
    const r = await verifyCheckoutShipping({
      supabase: d.client(), tenant, fulfillmentType: 'delivery', address: { country: 'FR', postal_code: '75011' },
      quoteToken: old, quantityByProduct: qty, subtotal: 3, clientShippingDetails: null, secret: SECRET,
    });
    expect(r).toMatchObject({ ok: false, status: 409, body: { code: SHIPPING_REQUOTE_REQUIRED } });
  });
  test('montant ou paquet altéré: jeton falsifié refusé', () => {
    const token = signQuoteV2({ ten: T1, t: 500, c: 'FR', z: '75011', w: 1, h: 'x', m: 'provider_cost', tid: null, tv: null, pq: null, av: null, cr: null, sv: null, gp: 'g1' }, SECRET);
    const [p, enc, sig] = token.split('.');
    const body = JSON.parse(Buffer.from(enc!, 'base64url').toString());
    body.t = 1;
    expect(verifyQuoteV2(`${p}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${sig}`, SECRET)).toEqual({ valid: false, reason: 'bad_signature' });
    expect(verifyQuoteV2(token, SECRET)).toMatchObject({ valid: true });
    expect(verifyQuoteV2(signQuoteV2({ ten: T1, t: 500, c: 'FR', z: '75011', w: 1, h: 'x', m: 'tariff', tid: null, tv: null, pq: null, av: null, cr: null, sv: null }, SECRET, 0), SECRET)).toEqual({ valid: false, reason: 'expired' });
  });
});

test.describe('repli provider', () => {
  const policy = (on: boolean): Pick<GeoPolicy, 'providerFallbackEnabled'> => ({ providerFallbackEnabled: on });
  test('réglage de politique: seulement pour l’absence de forfait', () => {
    const t = { shipping_tariff_fallback: 'unavailable' };
    expect(providerFallbackAllowed(t, policy(true), 'no_active_tariff')).toBe(true);
    expect(providerFallbackAllowed(t, policy(true), 'missing_product_weight')).toBe(false);
    expect(providerFallbackAllowed(t, policy(true), 'zone_not_covered')).toBe(false);
    expect(providerFallbackAllowed(t, policy(false), 'no_active_tariff')).toBe(false);
  });
  test('réglage historique du tenant inchangé', () => {
    expect(providerFallbackAllowed({ shipping_tariff_fallback: 'provider_cost' }, policy(false), 'zone_not_covered')).toBe(true);
  });
  test('empreinte de politique', () => {
    expect(geoPolicyStamp(defaultGeoPolicy())).toBe('g0');
    expect(geoPolicyStamp({ version: 3 })).toBe('g3');
  });
});

test.describe('calculateShipping rigoureux (international)', () => {
  const surcharge = { surcharge_amount: 1, surcharge_mode: 'per_parcel' as const, max_pack_kg: 15, box_length_cm: 30, box_width_cm: 20, box_height_cm: 20 };
  const input = (weight: number | null, vatRates: Array<{ countries: string[]; vat_rate: number }> = []) => ({
    cartItems: [{ weight_grams: weight, quantity: 1 }], from: { country: 'IT', zip_code: '42122' }, to: { country: 'US', zip_code: '10001' },
    packagingSurcharge: surcharge, vatRates, strict: {},
  });
  const mockFetch = (impl: () => Promise<Response>) => { (globalThis as { fetch: unknown }).fetch = impl; };
  const original = globalThis.fetch;
  test.afterEach(() => { (globalThis as { fetch: unknown }).fetch = original; });

  test('poids manquant: aucun peso de 400 g, aucun appel provider', async () => {
    let called = false;
    mockFetch(async () => { called = true; return new Response('[]'); });
    const r = await calculateShipping(input(null), 'k');
    expect(r).toMatchObject({ available: false, reason: 'missing_weight' });
    expect(called).toBe(false);
  });
  test('aucun service ≠ erreur API ≠ timeout', async () => {
    mockFetch(async () => new Response('[]'));
    expect(await calculateShipping(input(500), 'k')).toMatchObject({ available: false, reason: 'no_service' });
    mockFetch(async () => new Response('boom', { status: 500 }));
    expect(await calculateShipping(input(500), 'k')).toMatchObject({ available: false, reason: 'packlink_error' });
    mockFetch(async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; });
    expect(await calculateShipping(input(500), 'k')).toMatchObject({ available: false, reason: 'timeout' });
  });
  test('TVA: jamais déduite du seul pays', async () => {
    const service = [{ id: 1, name: 'S', carrier_name: 'C', dropoff: false, service_info: [], price: { base_price: 20, tax_price: 0 } }];
    mockFetch(async () => new Response(JSON.stringify(service)));
    expect(await calculateShipping(input(500), 'k')).toMatchObject({ available: false, reason: 'vat_unknown' });
    expect(await calculateShipping(input(500, [{ countries: ['US'], vat_rate: 0 }]), 'k')).toMatchObject({ available: true, shippingTotal: 21 });
    expect(hasExplicitVatRate('US', [{ countries: ['*'], vat_rate: 0.22 }])).toBe(true);
    expect(hasExplicitVatRate('US', [{ countries: ['IT'], vat_rate: 0.22 }])).toBe(false);
  });
});

test.describe('adresses internationales', () => {
  test('formats connus', () => {
    expect(isValidPostalCode('IT', '42121')).toBe(true);
    expect(isValidPostalCode('FR', '75011')).toBe(true);
    expect(isValidPostalCode('DE', '10115')).toBe(true);
    expect(isValidPostalCode('ES', '28013')).toBe(true);
    expect(isValidPostalCode('GB', 'sw1a 1aa')).toBe(true);
    expect(isValidPostalCode('GB', '12345')).toBe(false);
    expect(isValidPostalCode('US', '10001')).toBe(true);
    expect(isValidPostalCode('US', '10001-1234')).toBe(true);
    expect(isValidPostalCode('US', '1000')).toBe(false);
    expect(isValidPostalCode('NL', '1011 ab')).toBe(true);
  });
  test('zéros initiaux, lettres et espaces conservés', () => {
    expect(normalizePostalCode('IT', '00184')).toBe('00184');
    expect(normalizePostalCode('GB', ' sw1a   1aa ')).toBe('SW1A 1AA');
    expect(normalizePostalCode('PT', '1000-001')).toBe('1000-001');
  });
  test('pays sans code postal obligatoire', () => {
    expect(postalCodeRequired('AE')).toBe(false);
    expect(postalCodeRequired('IT')).toBe(true);
    expect(isValidPostalCode('AE', '')).toBe(true);
    expect(isValidPostalCode('IT', '')).toBe(false);
    const errors = validateAddressDraft({ country: 'AE', street: 'Sheikh Zayed Rd', houseNumber: '1', postalCode: '', city: 'Dubai', line2: '' }, { allowedCountries: ['AE'] });
    expect(errors.postalCode).toBeUndefined();
    const normalized = normalizeShippingAddress({ full_name: 'A B', line1: 'Rd 1', postal_code: '', city: 'Dubai', country: 'ae' });
    expect(normalized.ok).toBe(true);
  });
  test('CAP absent de l’index (pays hors liste): saisie libre acceptée sans association inventée', () => {
    expect(isValidPostalCode('SG', '018956')).toBe(true);
    const n = normalizeShippingAddress({ full_name: 'A B', line1: 'Rd 1', postal_code: '018956', city: 'Singapore', country: 'SG' });
    expect(n).toMatchObject({ ok: true, address: { postal_code: '018956', city: 'Singapore' } });
  });
  test('Sicile / Sardaigne restent des CAP italiens, jamais de faux pays', () => {
    expect(isValidPostalCode('IT', '90100')).toBe(true);
    expect(isValidPostalCode('IT', '09100')).toBe(true);
    expect(validateAddressDraft({ country: 'IT', street: 'Via Roma', houseNumber: '1', postalCode: '09100', city: 'Cagliari', line2: '' }).country).toBeUndefined();
  });
});
