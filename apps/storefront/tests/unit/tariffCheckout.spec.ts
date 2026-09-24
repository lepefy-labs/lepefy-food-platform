import { readFileSync } from 'fs';
import { join } from 'path';
import { expect, test } from '@playwright/test';
import type { ShippingTariffVersionRow } from '@lepefy/types';
import { FakeDb } from './helpers/fakeShippingSupabase';
import { CHLOEFOOD_TARIFF } from './fixtures/chloefoodTariff';
import {
  cartFingerprint, signQuote, signQuoteV2, verifyQuote, verifyQuoteV2, type QuoteV2Input,
} from '../../src/lib/shipping/quoteToken';
import {
  buildTariffShippingDetails, checkTariffAvailability, computeTariffQuote, planTariffParcels,
  type TariffPriced,
} from '../../src/lib/shipping/tariff/tariffQuote';
import {
  revalidateSessionShipping, verifyCheckoutShipping, SHIPPING_REQUOTE_REQUIRED,
  type CheckoutShippingTenant,
} from '../../src/lib/shipping/tariff/checkoutShipping';
import { buildActivationChecklist, perOrderSurchargeZones } from '../../src/lib/shipping/tariff/activationChecklist';
import { buildPublicGrid } from '../../src/lib/shipping/tariff/publicGrid';
import { summarizeShadowOrders } from '../../src/lib/shipping/tariff/shadowReport';

const SECRET = 'test-secret';
const T1 = 'tenant-chloe';
const T2 = 'tenant-other';

function version(overrides: Partial<ShippingTariffVersionRow> = {}): ShippingTariffVersionRow {
  return {
    id: 'ver-it-3', tenant_id: T1, country: 'IT', currency: 'EUR', version: 3, status: 'active', name: 'Grille 23/09',
    bands: CHLOEFOOD_TARIFF.bands, zone_surcharges: CHLOEFOOD_TARIFF.zoneSurcharges, non_deliverable_zones: ['IT_EXTRA_CUSTOMS'],
    max_parcel_weight_g: 15000, block_weight_g: 30000, block_price_cents: 1980, logistics_verified_max_weight_g: 50000,
    prices_include_vat: true, source_draft_id: null, notes: null, created_by: null, created_at: '', selected_at: null,
    retired_at: null, updated_at: '', activated_at: '2026-09-24T08:00:00Z', activated_by: 'admin-1', retired_by: null,
    ...overrides,
  };
}

const ZONES = [
  { id: 'z1', tenant_id: T1, code: 'IT_LOMBARDIA', country: 'IT', postal_prefixes: ['20'], active: true, position: 0 },
  { id: 'z2', tenant_id: T1, code: 'IT_SICILY', country: 'IT', postal_prefixes: ['90', '95'], active: true, position: 1 },
  { id: 'z3', tenant_id: T1, code: 'IT_EXTRA_CUSTOMS', country: 'IT', postal_prefixes: ['23041', '22061'], active: true, position: 2 },
  { id: 'z4', tenant_id: T1, code: 'IT_LOMBARDIA_NORD', country: 'IT', postal_prefixes: ['22', '23'], active: true, position: 3 },
  { id: 'z5', tenant_id: T2, code: 'IT_ALL', country: 'IT', postal_prefixes: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], active: true, position: 0 },
];

function makeDb(extra: Record<string, object[]> = {}) {
  return new FakeDb({
    shipping_tariff_versions: [
      version(),
      version({ id: 'ver-it-2', version: 2, status: 'shadow', bands: [{ min_g_exclusive: 0, max_g_inclusive: 30000, price_cents: 1 }] }),
      version({ id: 'ver-t2', tenant_id: T2, version: 1, bands: [{ min_g_exclusive: 0, max_g_inclusive: 30000, price_cents: 500 }], zone_surcharges: [], non_deliverable_zones: [] }),
    ],
    products: [
      { id: 'riz', tenant_id: T1, active: true, weight_grams: 1000, price: 3 },
      { id: 'mini', tenant_id: T1, active: true, weight_grams: 1, price: 1 },
      { id: 'epices', tenant_id: T1, active: true, weight_grams: null, price: 2 },
      { id: 'riz', tenant_id: T2, active: true, weight_grams: 1000, price: 3 },
    ],
    shipping_zones: ZONES,
    shipping_country_rules: [],
    shipping_vat_rates: [{ tenant_id: T1, countries: ['IT'], vat_rate: 0.22, active: true }],
    shipping_quote_observations: [],
    ...extra,
  });
}

const tenant = (overrides: Partial<CheckoutShippingTenant> = {}): CheckoutShippingTenant =>
  ({ id: T1, shipping_pricing_mode: 'tariff', shipping_tariff_fallback: 'unavailable', click_collect_enabled: true, ...overrides });

async function quote(db: FakeDb, grams: Map<string, number>, postalCode = '20121', tenantId = T1, subtotalCents = 1000) {
  return computeTariffQuote({ supabase: db.client(), tenantId, destination: { country: 'IT', postalCode }, quantityByProduct: grams, subtotalCents, clickCollectEnabled: true });
}
async function priced(db: FakeDb, qty: Map<string, number>, postalCode = '20121') {
  const r = await quote(db, qty, postalCode);
  if (r.kind !== 'priced') throw new Error(`not priced: ${r.kind} ${'reason' in r ? r.reason : ''}`);
  return r;
}
const kgOfRiz = (g: number) => new Map([['riz', Math.floor(g / 1000)], ...(g % 1000 ? [['mini', g % 1000] as [string, number]] : [])]);

function v2For(p: TariffPriced, qty: Map<string, number>, overrides: Partial<QuoteV2Input> = {}, now = Date.now()) {
  return signQuoteV2({
    ten: T1, t: p.finalCents, c: 'IT', z: p.destination.postalCode, w: p.weightG, h: cartFingerprint(qty), m: 'tariff',
    tid: p.version.id, tv: p.version.version, pq: 612, av: 'live', cr: 'Poste Italiane', sv: 'Crono', ...overrides,
  }, SECRET, now);
}

function checkout(db: FakeDb, token: string | null, qty: Map<string, number>, over: Partial<Parameters<typeof verifyCheckoutShipping>[0]> = {}) {
  return verifyCheckoutShipping({
    supabase: db.client(), tenant: tenant(), fulfillmentType: 'delivery', address: { country: 'IT', postal_code: '20121' },
    quoteToken: token, quantityByProduct: qty, subtotal: 10, clientShippingDetails: null, secret: SECRET, ...over,
  });
}

// ─── Token V2 ───────────────────────────────────────────────────────────────

test.describe('token de devis V2', () => {
  const input: QuoteV2Input = { ten: T1, t: 840, c: 'it', z: ' 20121 ', w: 4500, h: 'abc', m: 'tariff', tid: 'v', tv: 1, pq: null, av: 'live', cr: null, sv: null };

  test('signé, vérifié, champs canoniques', () => {
    const r = verifyQuoteV2(signQuoteV2(input, SECRET), SECRET);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.payload).toMatchObject({ v: 2, ten: T1, t: 840, c: 'IT', z: '20121', w: 4500 });
  });

  test('altéré, expiré, mauvais secret → refusé', () => {
    const token = signQuoteV2(input, SECRET);
    const [p, enc, sig] = token.split('.');
    const tampered = JSON.parse(Buffer.from(enc!, 'base64url').toString());
    tampered.t = 1;
    expect(verifyQuoteV2(`${p}.${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${sig}`, SECRET)).toEqual({ valid: false, reason: 'bad_signature' });
    expect(verifyQuoteV2(token, 'other')).toEqual({ valid: false, reason: 'bad_signature' });
    expect(verifyQuoteV2(signQuoteV2(input, SECRET, 0), SECRET)).toEqual({ valid: false, reason: 'expired' });
  });

  test('legacy et V2 ne sont jamais interchangeables', () => {
    expect(verifyQuote(signQuoteV2(input, SECRET), SECRET).valid).toBe(false);
    expect(verifyQuoteV2(signQuote(8.4, 'IT', '20121', SECRET), SECRET)).toEqual({ valid: false, reason: 'not_v2' });
  });

  test('empreinte du panier indépendante de l’ordre des lignes', () => {
    expect(cartFingerprint(new Map([['a', 1], ['b', 2]]))).toBe(cartFingerprint(new Map([['b', 2], ['a', 1]])));
    expect(cartFingerprint(new Map([['a', 1]]))).not.toBe(cartFingerprint(new Map([['a', 2]])));
  });
});

// ─── Devis commercial ─────────────────────────────────────────────────────

test.describe('computeTariffQuote — grille ChloeFood depuis la version active', () => {
  test('bornes 5 000 / 5 001 g et 15 000 / 15 001 g (poids serveur)', async () => {
    const db = makeDb();
    expect((await priced(db, kgOfRiz(5000))).finalCents).toBe(840);
    expect((await priced(db, kgOfRiz(5001))).finalCents).toBe(1080);
    expect((await priced(db, kgOfRiz(15000))).finalCents).toBe(1260);
    expect((await priced(db, kgOfRiz(15001))).finalCents).toBe(1640);
  });

  test('20, 30, 30,001, 45, 60 et 90 kg', async () => {
    const db = makeDb();
    const cases: Array<[number, number]> = [[20000, 1640], [30000, 1980], [30001, 2820], [45000, 3240], [60000, 3960], [90000, 5940]];
    for (const [g, cents] of cases) expect((await priced(db, kgOfRiz(g))).finalCents).toBe(cents);
  });

  test('supplément par colis (Sicile) et par commande', async () => {
    expect((await priced(makeDb(), kgOfRiz(20000), '90121')).finalCents).toBe(1640 + 400);
    const perOrder = makeDb({ shipping_tariff_versions: [version({ zone_surcharges: [{ zone_code: 'IT_SICILY', amount_cents: 200, mode: 'per_order' }] })] });
    expect((await priced(perOrder, kgOfRiz(20000), '90121')).finalCents).toBe(1640 + 200);
  });

  test('Livigno et Campione jamais livrables, même avec flat_rate_override', async () => {
    const db = makeDb({ shipping_country_rules: [{ tenant_id: T1, active: true, countries: ['IT'], free_shipping_above: null, flat_rate_override: 5, discount_type: null, discount_value: null }] });
    for (const cap of ['23041', '22061']) {
      const r = await quote(db, kgOfRiz(1000), cap);
      expect(r).toMatchObject({ kind: 'unavailable', reason: 'extra_customs' });
    }
  });

  test('zone non livrable par la version, zone non résolue, poids manquant, pays sans tarif', async () => {
    const db = makeDb({ shipping_zones: [...ZONES, { id: 'z9', tenant_id: T1, code: 'IT_EXTRA_CUSTOMS', country: 'IT', postal_prefixes: ['23030'], active: true, position: 9 }] });
    expect(await quote(db, kgOfRiz(1000), '23030')).toMatchObject({ kind: 'unavailable', reason: 'zone_not_deliverable' });
    expect(await quote(db, kgOfRiz(1000), '42122')).toEqual({ kind: 'fallback', reason: 'zone_not_covered', missingProductIds: [] });
    expect(await quote(db, new Map([['riz', 1], ['epices', 2]]))).toEqual({ kind: 'fallback', reason: 'missing_product_weight', missingProductIds: ['epices'] });
    const fr = await computeTariffQuote({ supabase: db.client(), tenantId: T1, destination: { country: 'FR', postalCode: '75001' }, quantityByProduct: kgOfRiz(1000), subtotalCents: 0, clickCollectEnabled: false });
    expect(fr).toMatchObject({ kind: 'fallback', reason: 'no_active_tariff' });
    expect(await quote(db, new Map([['inconnu', 1]]))).toMatchObject({ kind: 'unavailable', reason: 'product_unavailable' });
  });

  test('une version shadow n’est jamais facturée', async () => {
    const db = makeDb({ shipping_tariff_versions: [version({ status: 'shadow' })] });
    expect(await quote(db, kgOfRiz(1000))).toMatchObject({ kind: 'fallback', reason: 'no_active_tariff' });
  });

  test('flat_rate_override, remise puis gratuité (précédence du checkout live)', async () => {
    const rule = (r: object) => makeDb({ shipping_country_rules: [{ tenant_id: T1, active: true, countries: ['IT'], free_shipping_above: null, flat_rate_override: null, discount_type: null, discount_value: null, ...r }] });
    expect((await priced(rule({ flat_rate_override: 6, discount_type: 'fixed', discount_value: 1 }), kgOfRiz(20000))).finalCents).toBe(500);
    expect((await priced(rule({ discount_type: 'percentage', discount_value: 10 }), kgOfRiz(1000))).finalCents).toBe(756);
    const free = await quote(rule({ free_shipping_above: 99.99 }), kgOfRiz(1000), '20121', T1, 9999);
    expect(free).toMatchObject({ kind: 'priced', finalCents: 0, commercial: { freeShippingApplied: true, theoreticalCents: 840 } });
    expect((await quote(rule({ free_shipping_above: 99.99 }), kgOfRiz(1000), '20121', T1, 9998))).toMatchObject({ finalCents: 840 });
  });

  test('TVA ajoutée une seule fois sur une version HT, arrondi au centime', async () => {
    const db = makeDb({ shipping_tariff_versions: [version({ prices_include_vat: false, bands: [{ min_g_exclusive: 0, max_g_inclusive: 30000, price_cents: 689 }] })] });
    const p = await priced(db, kgOfRiz(1000));
    expect(p.finalCents).toBe(689 + Math.round(689 * 0.22));
    expect(p.price.vat).toMatchObject({ includedInTariff: false, rate: 0.22, amountCents: 152 });
  });

  test('deux tenants, deux tarifs', async () => {
    const db = makeDb();
    expect((await priced(db, kgOfRiz(1000))).finalCents).toBe(840);
    const other = await quote(db, kgOfRiz(1000), '20121', T2);
    expect(other).toMatchObject({ kind: 'priced', finalCents: 500 });
    for (const table of ['shipping_tariff_versions', 'products', 'shipping_zones']) {
      expect(db.unscopedQueries(table, T1).every((q) => q.filters.some((f) => f.col === 'tenant_id' && f.value === T2))).toBe(true);
    }
  });
});

// ─── Vérification au checkout (Stripe, magasin, lien externe, session) ────

test.describe('verifyCheckoutShipping', () => {
  test('token V2 valide : montant du token, snapshot reconstruit côté serveur', async () => {
    const db = makeDb();
    const qty = kgOfRiz(4500);
    const p = await priced(db, qty);
    const r = await checkout(db, v2For(p, qty), qty, { clientShippingDetails: { tariff: { finalCents: 1 }, packlinkCost: 0.01, pricingMode: 'tariff' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shippingTotal).toBe(8.4);
    expect(r.shippingDetails).toMatchObject({
      pricingMode: 'tariff', totalWeightG: 4500, numParcels: 1, carrierName: 'Poste Italiane',
      tariff: { versionId: 'ver-it-3', version: 3, finalCents: 840, zoneCode: 'IT_LOMBARDIA', weightG: 4500, providerQuoteTtcCents: 612, availability: { source: 'live' } },
    });
    expect(r.shippingDetails).not.toHaveProperty('packlinkCost');
  });

  test('panier modifié par le navigateur après le devis → nouveau devis', async () => {
    const db = makeDb();
    const qty = kgOfRiz(4500);
    const token = v2For(await priced(db, qty), qty);
    const r = await checkout(db, token, kgOfRiz(9000));
    expect(r).toMatchObject({ ok: false, status: 409, body: { code: SHIPPING_REQUOTE_REQUIRED } });
  });

  test('poids ou montant falsifié dans le token → signature invalide', async () => {
    const db = makeDb();
    const qty = kgOfRiz(9000);
    const p = await priced(db, qty);
    const cheap = signQuoteV2({ ten: T1, t: 840, c: 'IT', z: '20121', w: 4500, h: cartFingerprint(qty), m: 'tariff', tid: p.version.id, tv: 3, pq: null, av: 'live', cr: null, sv: null }, 'guessed-secret');
    expect(await checkout(db, cheap, qty)).toMatchObject({ ok: false, status: 409 });
    // Même signé avec le bon secret, un montant qui ne correspond pas au recalcul est refusé.
    const lying = v2For(p, qty, { t: 840, w: 4500 });
    expect(await checkout(db, lying, qty)).toMatchObject({ ok: false, status: 409, body: { code: SHIPPING_REQUOTE_REQUIRED } });
  });

  test('token expiré, adresse ou tenant différents → nouveau devis', async () => {
    const db = makeDb();
    const qty = kgOfRiz(1000);
    const p = await priced(db, qty);
    expect(await checkout(db, v2For(p, qty, {}, 0), qty)).toMatchObject({ status: 409 });
    expect(await checkout(db, v2For(p, qty), qty, { address: { country: 'IT', postal_code: '90121' } })).toMatchObject({ status: 409 });
    expect(await checkout(db, v2For(p, qty, { ten: T2 }), qty)).toMatchObject({ status: 409 });
  });

  test('token legacy refusé en mode tariff ; accepté (comportement actuel) en provider_cost', async () => {
    const db = makeDb();
    const qty = kgOfRiz(1000);
    const legacy = signQuote(8.89, 'IT', '20121', SECRET);
    expect(await checkout(db, legacy, qty)).toMatchObject({ ok: false, status: 409, body: { code: SHIPPING_REQUOTE_REQUIRED } });
    const details = { packlinkCost: 4.83, vatAmount: 1.06, packagingSurchargeTotal: 3 };
    const ok = await checkout(db, legacy, qty, { tenant: tenant({ shipping_pricing_mode: 'provider_cost' }), clientShippingDetails: details });
    expect(ok).toEqual({ ok: true, shippingTotal: 8.89, shippingDetails: details });
    expect(db.log.filter((q) => q.table === 'shipping_tariff_versions')).toHaveLength(0);
  });

  test('rollback vers provider_cost : un token V2 au forfait n’est plus accepté', async () => {
    const db = makeDb();
    const qty = kgOfRiz(1000);
    const token = v2For(await priced(db, qty), qty);
    expect(await checkout(db, token, qty, { tenant: tenant({ shipping_pricing_mode: 'provider_cost' }) })).toMatchObject({ status: 409 });
  });

  test('tarif remplacé entre devis et checkout → nouveau devis et nouvelle confirmation', async () => {
    const db = makeDb();
    const qty = kgOfRiz(1000);
    const token = v2For(await priced(db, qty), qty);
    const rows = db.tables.shipping_tariff_versions!;
    rows.find((r) => r.id === 'ver-it-3')!.status = 'retired';
    rows.push(version({ id: 'ver-it-4', version: 4, bands: [{ min_g_exclusive: 0, max_g_inclusive: 30000, price_cents: 990 }] }) as never);
    expect(await checkout(db, token, qty)).toMatchObject({ ok: false, status: 409, body: { code: SHIPPING_REQUOTE_REQUIRED } });
  });

  test('code postal hors zones (ex. Corse) : repli provider si configuré, sinon indisponible', async () => {
    const db = makeDb();
    const qty = kgOfRiz(1000);
    const token = signQuoteV2({ ten: T1, t: 5028, c: 'IT', z: '42122', w: 0, h: cartFingerprint(qty), m: 'provider_cost', tid: null, tv: null, pq: null, av: 'provider_cost_fallback', cr: null, sv: null }, SECRET);
    const address = { country: 'IT', postal_code: '42122' };
    expect(await checkout(db, token, qty, { address })).toMatchObject({ status: 409 });
    const ok = await checkout(db, token, qty, { address, tenant: tenant({ shipping_tariff_fallback: 'provider_cost' }) });
    expect(ok).toMatchObject({ ok: true, shippingTotal: 50.28, shippingDetails: { pricingMode: 'provider_cost_fallback', tariffFallback: { reason: 'zone_not_covered' } } });
  });

  test('repli provider_cost : seulement s’il est configuré et que le forfait ne s’applique toujours pas', async () => {
    const db = makeDb();
    const qty = new Map([['riz', 1], ['epices', 1]]);
    const token = signQuoteV2({ ten: T1, t: 889, c: 'IT', z: '20121', w: 0, h: cartFingerprint(qty), m: 'provider_cost', tid: null, tv: null, pq: null, av: 'provider_cost_fallback', cr: null, sv: null }, SECRET);
    expect(await checkout(db, token, qty)).toMatchObject({ status: 409 });
    const ok = await checkout(db, token, qty, { tenant: tenant({ shipping_tariff_fallback: 'provider_cost' }), clientShippingDetails: { packlinkCost: 4.83 } });
    expect(ok).toMatchObject({ ok: true, shippingTotal: 8.89, shippingDetails: { pricingMode: 'provider_cost_fallback', packlinkCost: 4.83 } });
  });

  test('retrait en magasin : aucun forfait, aucune vérification de devis', async () => {
    const db = makeDb();
    const r = await checkout(db, null, kgOfRiz(1000), { fulfillmentType: 'pickup', address: null });
    expect(r).toEqual({ ok: true, shippingTotal: 0, shippingDetails: null });
  });
});

test.describe('revalidateSessionShipping (reprise, create-intent, PATCH sans devis)', () => {
  async function sessionFor(db: FakeDb, qty: Map<string, number>) {
    const p = await priced(db, qty);
    return { details: buildTariffShippingDetails(p, { source: 'live', providerQuoteTtcCents: null, carrier: null, service: null }), total: p.finalCents / 100 };
  }
  const input = (db: FakeDb, s: { details: Record<string, unknown>; total: number }, qty: Map<string, number>, t = tenant()) => ({
    supabase: db.client(), tenant: t, fulfillmentType: 'delivery' as const, address: { country: 'IT', postal_code: '20121' },
    shippingDetails: s.details, shippingTotal: s.total, quantityByProduct: qty, subtotal: 10,
  });

  test('même tarif, même panier : snapshot conservé', async () => {
    const db = makeDb();
    const qty = kgOfRiz(1000);
    expect(await revalidateSessionShipping(input(db, await sessionFor(db, qty), qty))).toEqual({ ok: true, tariffManaged: true });
  });

  test('panier modifié, tarif remplacé, montant de session altéré, rollback → nouveau devis', async () => {
    const db = makeDb();
    const qty = kgOfRiz(1000);
    const s = await sessionFor(db, qty);
    expect(await revalidateSessionShipping(input(db, s, kgOfRiz(6000)))).toMatchObject({ status: 409 });
    expect(await revalidateSessionShipping(input(db, { ...s, total: 1 }, qty))).toMatchObject({ status: 409 });
    expect(await revalidateSessionShipping(input(db, s, qty, tenant({ shipping_pricing_mode: 'provider_cost' })))).toMatchObject({ status: 409 });
    db.tables.shipping_tariff_versions!.find((r) => r.id === 'ver-it-3')!.status = 'retired';
    expect(await revalidateSessionShipping(input(db, s, qty))).toMatchObject({ status: 409 });
  });

  test('session créée avant l’activation → nouveau devis ; mode actuel → inchangé', async () => {
    const db = makeDb();
    const qty = kgOfRiz(1000);
    const legacy = { details: { packlinkCost: 4.83 }, total: 8.89 };
    expect(await revalidateSessionShipping(input(db, legacy, qty))).toMatchObject({ status: 409 });
    expect(await revalidateSessionShipping(input(db, legacy, qty, tenant({ shipping_pricing_mode: 'provider_cost' })))).toEqual({ ok: true, tariffManaged: false });
  });
});

// ─── Disponibilité logistique ─────────────────────────────────────────────

test.describe('checkTariffAvailability', () => {
  const PROFILES = [
    { id: 'S', name: 'S', box_length_cm: 35, box_width_cm: 25, box_height_cm: 22, active: true, position: 1, is_default: false, suggest_min_weight_g: 0, suggest_max_weight_g: 5000, tare_g: 200 },
    { id: 'M', name: 'M', box_length_cm: 40, box_width_cm: 30, box_height_cm: 30, active: true, position: 2, is_default: true, suggest_min_weight_g: 5000, suggest_max_weight_g: 15000, tare_g: 400 },
  ];
  const service = (id: number, base: number, dropoff = false) => ({ id, name: `S${id}`, carrier_name: 'Poste', dropoff, service_info: [], price: { base_price: base, tax_price: 0 } });

  async function run(db: FakeDb, p: TariffPriced, fetchServices: Parameters<typeof checkTariffAvailability>[0]['fetchServices'], provider = 'packlink') {
    return checkTariffAvailability({
      supabase: db.client(), tenantId: T1, shippingProvider: provider, apiKey: 'key', priced: p, vatRate: 0.22,
      profiles: PROFILES as never, defaultBox: null, fetchServices,
    });
  }

  test('même plan de colis que la préparation : 15 + 5 kg, carton par colis, tare comprise', () => {
    const plan = planTariffParcels(20000, 15000, PROFILES as never, null)!;
    expect(plan.map((x) => [x.netG, x.grossG, x.profileId])).toEqual([[15000, 15400, 'M'], [5000, 5200, 'S']]);
  });

  test('appel limité dans le temps, service éligible le moins cher, devis persisté', async () => {
    const db = makeDb();
    const p = await priced(db, kgOfRiz(20000));
    let timeout: number | undefined;
    const r = await run(db, p, async (_k, _f, _t, parcels, opts) => {
      timeout = opts?.timeoutMs;
      expect(parcels).toEqual([{ weight: 15.4, width: 30, height: 30, length: 40 }, { weight: 5.2, width: 25, height: 22, length: 35 }]);
      return { kind: 'ok', services: [service(1, 3, true), service(2, 7.89)] as never };
    });
    expect(timeout).toBe(6000);
    expect(r).toMatchObject({ available: true, source: 'live', providerQuoteTtcCents: 789 + 174 });
    expect(db.tables.shipping_quote_observations!.length).toBe(2);
    // Deuxième devis identique : réemploi de l'observation, aucun appel.
    const again = await run(db, p, async () => { throw new Error('ne doit pas appeler Packlink'); });
    expect(again).toMatchObject({ available: true, source: 'observation' });
  });

  test('refus, aucun service, aucun service éligible → indisponible', async () => {
    const p = await priced(makeDb(), kgOfRiz(1000));
    expect(await run(makeDb(), p, async () => ({ kind: 'rejected', status: 400 }))).toMatchObject({ available: false, reason: 'provider_rejected' });
    expect(await run(makeDb(), p, async () => ({ kind: 'ok', services: [] }))).toMatchObject({ available: false, reason: 'no_service' });
    expect(await run(makeDb(), p, async () => ({ kind: 'ok', services: [service(1, 3, true)] as never }))).toMatchObject({ available: false, reason: 'no_eligible_service' });
  });

  test('erreur ou timeout Packlink : preuve récente du CAP seulement, jamais au-delà de la limite vérifiée', async () => {
    const recent = { id: 'o1', tenant_id: T1, provider: 'packlink', destination_country: 'IT', destination_postal_code: '20121', eligible: true, observed_at: new Date().toISOString() };
    const failing = async () => ({ kind: 'error' as const, status: null });
    const p = await priced(makeDb(), kgOfRiz(1000));
    expect(await run(makeDb(), p, failing)).toMatchObject({ available: false, reason: 'provider_unavailable' });
    expect(await run(makeDb({ shipping_quote_observations: [recent] }), p, failing)).toMatchObject({ available: true, source: 'recent_evidence', providerQuoteTtcCents: null });
    const heavy = await priced(makeDb(), kgOfRiz(60000));
    expect(await run(makeDb({ shipping_quote_observations: [recent] }), heavy, failing)).toMatchObject({ available: false, reason: 'provider_unavailable' });
  });

  test('provider sans API de devis : non vérifié, jamais présenté comme un devis', async () => {
    const p = await priced(makeDb(), kgOfRiz(1000));
    expect(await run(makeDb(), p, async () => { throw new Error('no call'); }, 'flat_rate')).toMatchObject({ available: true, source: 'not_checked', providerQuoteTtcCents: null });
  });
});

// ─── Admin, grille publique, rapport ──────────────────────────────────────

test.describe('activation et grille publique', () => {
  const base = { migrationReady: true, missingWeightProducts: 0, zoneCodes: ['IT_EXTRA_CUSTOMS'], profiles: [], countryRule: null, fallback: 'unavailable' as const };

  test('checklist : migration bloquante, suppléments par commande signalés', () => {
    expect(buildActivationChecklist({ ...base, version: version(), migrationReady: false }).find((i) => i.key === 'migration')?.status).toBe('blocking');
    const perOrder = version({ zone_surcharges: [{ zone_code: 'IT_SICILY', amount_cents: 200, mode: 'per_order' }] });
    expect(perOrderSurchargeZones(perOrder)).toEqual(['IT_SICILY']);
    expect(buildActivationChecklist({ ...base, version: perOrder }).find((i) => i.key === 'surcharges_per_parcel')?.status).toBe('warning');
    expect(buildActivationChecklist({ ...base, version: version({ non_deliverable_zones: [] }) }).find((i) => i.key === 'non_deliverable')?.status).toBe('warning');
    expect(buildActivationChecklist({ ...base, version: version() }).filter((i) => i.status === 'blocking')).toEqual([]);
  });

  test('grille publique générée depuis la version active uniquement', () => {
    const grid = buildPublicGrid([version(), version({ id: 's', status: 'shadow' })], [{ countries: ['IT'], free_shipping_above: 99.99, flat_rate_override: null, discount_type: null, discount_value: null }]);
    expect(grid).toHaveLength(1);
    expect(grid[0]).toMatchObject({ country: 'IT', freeShippingAboveCents: 9999, block: { weightG: 30000, priceCents: 1980 }, flatRateOverrideCents: null });
    expect(grid[0]!.bands[0]).toEqual({ minG: 0, maxG: 5000, priceCents: 840 });
    expect(grid[0]!.extraCustomsTerritories.map((t) => t.postalCode).sort()).toEqual(['22061', '23041']);
  });

  test('rapport : commandes au forfait séparées des simulations shadow', async () => {
    const db = makeDb();
    const details = buildTariffShippingDetails(await priced(db, kgOfRiz(1000)), { source: 'live', providerQuoteTtcCents: 700, carrier: null, service: null });
    const report = summarizeShadowOrders([
      { id: 'o1', created_at: '2026-09-24T10:00:00Z', fulfillment_type: 'delivery', shipping_details: details },
      { id: 'o2', created_at: '2026-09-24T10:00:00Z', fulfillment_type: 'delivery', shipping_details: { pricingMode: 'provider_cost_fallback' } },
    ]);
    expect(report.commercial).toMatchObject({ orders: 1, fallbackOrders: 1, avgChargedCents: 840, avgGapBeforePackagingCents: 140, negativeGap: 0 });
    expect(report.withoutShadow).toBe(0);
  });
});

// ─── Garde-fous de câblage (tous les parcours de paiement) ────────────────

test.describe('parcours de paiement', () => {
  const src = (rel: string) => readFileSync(join(__dirname, '../../src', rel), 'utf8');

  test('Stripe, magasin, lien externe et PATCH de session vérifient via verifyCheckoutShipping', () => {
    for (const rel of ['app/api/checkout/route.ts', 'app/api/checkout/external-link/route.ts', 'app/api/checkout-sessions/[id]/route.ts']) {
      const code = src(rel);
      expect(code, rel).toContain('verifyCheckoutShipping(');
      expect(code, rel).not.toContain('verifyQuote(');
    }
  });

  test('create-intent et PATCH sans devis revalident le tarif enregistré', () => {
    expect(src('app/api/checkout-sessions/[id]/create-intent/route.ts')).toContain('revalidateSessionShipping(');
    expect(src('app/api/checkout-sessions/[id]/route.ts')).toContain('revalidateSessionShipping(');
  });

  test('webhook : snapshot de session conservé, doublons ignorés (23505)', () => {
    const webhook = src('app/api/webhooks/stripe/route.ts');
    expect(webhook).toContain('shipping_details:          checkoutSession.shipping_details ?? null');
    expect(webhook).toContain("'23505'");
    expect(src('lib/orders/createOrderFromCheckoutSession.ts')).toContain('shipping_details: session.shipping_details ?? null');
  });
});
