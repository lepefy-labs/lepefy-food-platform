import { readFileSync } from 'fs';
import { join } from 'path';
import { expect, test } from '@playwright/test';
import { FakeDb } from './helpers/fakeShippingSupabase';
import { CHLOEFOOD_TARIFF } from './fixtures/chloefoodTariff';
import {
  resolveCheckoutShippingDetails,
  stripShadowTariff,
  verifyProviderQuote,
  type ResolveCheckoutShippingDetailsInput,
  type ShadowTariffRecord,
} from '../../src/lib/shipping/tariff/shadowTariff';
import { signQuote, verifyQuote } from '../../src/lib/shipping/quoteToken';
import { upsertActiveCheckoutSession } from '../../src/lib/checkout/activeCheckoutSession';

const TENANT = 'tenant-chloe';
const OTHER = 'tenant-other';

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ver-2', tenant_id: TENANT, country: 'IT', currency: 'EUR', version: 2, status: 'shadow', name: 'Grille',
    bands: CHLOEFOOD_TARIFF.bands, zone_surcharges: CHLOEFOOD_TARIFF.zoneSurcharges, non_deliverable_zones: ['IT_EXTRA_CUSTOMS'],
    max_parcel_weight_g: 15000, block_weight_g: 30000, block_price_cents: 1980, logistics_verified_max_weight_g: 50000,
    prices_include_vat: true, source_draft_id: null, notes: null, created_by: null, created_at: '', selected_at: null, retired_at: null, updated_at: '',
    ...overrides,
  };
}

function makeDb(extra: Record<string, object[]> = {}) {
  return new FakeDb({
    shipping_tariff_versions: [
      versionRow(),
      versionRow({ id: 'ver-1', version: 1, status: 'retired', bands: [{ min_g_exclusive: 0, max_g_inclusive: 30000, price_cents: 100 }] }),
      // Un autre tenant a une version shadow IT beaucoup moins chère : ne doit jamais être lue.
      versionRow({ id: 'ver-other', tenant_id: OTHER, version: 1, bands: [{ min_g_exclusive: 0, max_g_inclusive: 30000, price_cents: 1 }] }),
    ],
    products: [
      { id: 'riz', tenant_id: TENANT, weight_grams: 1000 },
      { id: 'huile', tenant_id: TENANT, weight_grams: 2500 },
      { id: 'epices', tenant_id: TENANT, weight_grams: null },
      { id: 'riz', tenant_id: OTHER, weight_grams: 1 },
    ],
    shipping_zones: [
      { id: 'z1', tenant_id: TENANT, code: 'IT_LOMBARDIA', country: 'IT', postal_prefixes: ['20'], active: true, position: 0 },
      { id: 'z2', tenant_id: TENANT, code: 'IT_SICILY', country: 'IT', postal_prefixes: ['90', '95'], active: true, position: 1 },
      { id: 'z3', tenant_id: TENANT, code: 'IT_EXTRA_CUSTOMS', country: 'IT', postal_prefixes: ['23041'], active: true, position: 2 },
    ],
    shipping_country_rules: [],
    shipping_vat_rates: [{ tenant_id: TENANT, countries: ['IT'], vat_rate: 0.22, active: true }],
    ...extra,
  });
}

// Détails renvoyés par /api/shipping/quote (Packlink) : 4,83 + 1,06 TVA + 3,00 emballage = 8,89 € signés.
const LIVE_DETAILS = {
  totalWeightG: 4500, numParcels: 1, packlinkCost: 4.83, vatRate: 0.22, vatAmount: 1.06, vatSource: 'db',
  surchargeMode: 'per_parcel', packagingSurchargeTotal: 3, boxDimensions: { length: 40, width: 30, height: 20 },
  serviceId: 1, serviceName: 'Standard', carrierName: 'Poste',
};

function input(db: FakeDb, overrides: Partial<ResolveCheckoutShippingDetailsInput> = {}): ResolveCheckoutShippingDetailsInput {
  return {
    supabase: db.client(),
    tenantId: TENANT,
    pricingMode: 'shadow',
    fulfillmentType: 'delivery',
    destination: { country: 'IT', postalCode: '20121' },
    quantityByProduct: new Map([['riz', 2], ['huile', 1]]),
    subtotal: 24.5,
    chargedShippingTotal: 8.89,
    clientShippingDetails: { ...LIVE_DETAILS },
    ...overrides,
  };
}

async function shadowOf(db: FakeDb, overrides: Partial<ResolveCheckoutShippingDetailsInput> = {}) {
  const details = await resolveCheckoutShippingDetails(input(db, overrides));
  return { details, shadow: details?.shadow_tariff as ShadowTariffRecord | undefined };
}

test.describe('shadow désactivé : checkout identique', () => {
  test('provider_cost : détails renvoyés tels quels, aucune requête', async () => {
    const db = makeDb();
    const client = { ...LIVE_DETAILS };
    const details = await resolveCheckoutShippingDetails(input(db, { pricingMode: 'provider_cost', clientShippingDetails: client }));
    expect(details).toBe(client);
    expect(db.log).toHaveLength(0);
  });

  test('migration absente (mode undefined) et mode tariff non supporté : aucun calcul', async () => {
    for (const pricingMode of [undefined, 'tariff']) {
      const db = makeDb();
      const details = await resolveCheckoutShippingDetails(input(db, { pricingMode }));
      expect(details).toEqual(LIVE_DETAILS);
      expect(db.log).toHaveLength(0);
    }
  });

  test('un shadow_tariff envoyé par le navigateur est toujours retiré', async () => {
    const forged = { ...LIVE_DETAILS, shadow_tariff: { schema: 1, status: 'complete', shadowTtcCents: 1 } };
    const off = await resolveCheckoutShippingDetails(input(makeDb(), { pricingMode: 'provider_cost', clientShippingDetails: forged }));
    expect(off).toEqual(LIVE_DETAILS);
    const { shadow } = await shadowOf(makeDb(), { clientShippingDetails: forged });
    expect(shadow?.shadowTtcCents).toBe(840);
    expect(stripShadowTariff(null)).toBeNull();
  });
});

test.describe('shadow activé', () => {
  test('calcul complet côté serveur, montant facturé et détails live intacts', async () => {
    const { details, shadow } = await shadowOf(makeDb());
    const { shadow_tariff: _s, ...rest } = details!;
    expect(rest).toEqual(LIVE_DETAILS);
    expect(shadow).toMatchObject({
      status: 'complete',
      reasons: [],
      tariff: { versionId: 'ver-2', version: 2, country: 'IT' },
      destination: { country: 'IT', postalCode: '20121', zoneCode: 'IT_LOMBARDIA' },
      weight: { netG: 4500, missingWeightProductIds: [], tareG: null },
      shadowTtcCents: 840,
      chargedCents: 889,
      provider: { verification: 'matches_signed_total', quoteTtcCents: 589, packagingSurchargeChargedCents: 300 },
      packagingCostCents: null,
      comparison: { shadowMinusChargedCents: 840 - 889, expectedMarginBeforePackagingCents: 840 - 589, expectedMarginCents: null },
    });
    expect(shadow?.pricing).toMatchObject({ numParcels: 1, parcelsG: [4500], theoreticalTtcCents: 840, vatRate: 0.22, vatIncludedInTariff: true });
  });

  test('poids déclaré par le navigateur ignoré : seul products.weight_grams compte', async () => {
    const { shadow } = await shadowOf(makeDb(), { clientShippingDetails: { ...LIVE_DETAILS, totalWeightG: 100 } });
    expect(shadow?.weight.netG).toBe(4500);
    expect(shadow?.shadowTtcCents).toBe(840);
  });

  test('produit sans poids : incomplet, identifiants enregistrés, aucun repli 400 g', async () => {
    const { shadow } = await shadowOf(makeDb(), { quantityByProduct: new Map([['riz', 1], ['epices', 3], ['inconnu', 1]]) });
    expect(shadow).toMatchObject({ status: 'incomplete', reasons: ['missing_product_weight'], shadowTtcCents: null, pricing: null });
    expect(shadow?.weight).toEqual({ netG: null, missingWeightProductIds: ['epices', 'inconnu'], tareG: null });
  });

  test('isolement des tenants : versions, produits et zones filtrés par tenant', async () => {
    const db = makeDb();
    const { shadow } = await shadowOf(db);
    expect(shadow?.tariff?.versionId).toBe('ver-2');
    for (const table of ['shipping_tariff_versions', 'products', 'shipping_zones', 'shipping_country_rules', 'shipping_vat_rates']) {
      expect(db.unscopedQueries(table, TENANT)).toEqual([]);
    }
  });

  test('supplément par colis et zone non livrable', async () => {
    const sicily = await shadowOf(makeDb(), { destination: { country: 'IT', postalCode: '90121' }, quantityByProduct: new Map([['riz', 20]]) });
    expect(sicily.shadow).toMatchObject({ status: 'complete', shadowTtcCents: 1640 + 400 });
    expect(sicily.shadow?.pricing?.parcelsG).toEqual([15000, 5000]);
    const livigno = await shadowOf(makeDb(), { destination: { country: 'IT', postalCode: '23041' } });
    expect(livigno.shadow).toMatchObject({ status: 'unavailable', reasons: ['zone_not_deliverable'] });
  });

  test('zone non résolue : prix théorique calculé mais simulation incomplète', async () => {
    const { shadow } = await shadowOf(makeDb(), { destination: { country: 'IT', postalCode: '42122' } });
    expect(shadow).toMatchObject({ status: 'incomplete', reasons: ['zone_unresolved'], shadowTtcCents: 840 });
    expect(shadow?.comparison.expectedMarginBeforePackagingCents).toBeNull();
  });

  test('aucune version shadow pour le pays', async () => {
    const { shadow } = await shadowOf(makeDb(), { destination: { country: 'FR', postalCode: '75001' } });
    expect(shadow).toMatchObject({ status: 'unavailable', reasons: ['no_shadow_tariff'], tariff: null });
  });

  test('configuration tarifaire invalide jamais prix', async () => {
    const db = makeDb({ shipping_tariff_versions: [versionRow({ bands: [{ min_g_exclusive: 10, max_g_inclusive: 5, price_cents: 1 }] })] });
    const { shadow } = await shadowOf(db);
    expect(shadow).toMatchObject({ status: 'error', reasons: ['invalid_tariff_config'], shadowTtcCents: null });
  });

  test('changement de version entre devis et checkout : version courante enregistrée, montant facturé inchangé', async () => {
    const db = makeDb();
    const before = await shadowOf(db);
    const rows = db.tables.shipping_tariff_versions!;
    rows.find((r) => r.id === 'ver-2')!.status = 'retired';
    rows.find((r) => r.id === 'ver-1')!.status = 'shadow';
    const after = await shadowOf(db);
    expect(before.shadow?.tariff?.version).toBe(2);
    expect(after.shadow?.tariff?.version).toBe(1);
    expect(after.shadow?.shadowTtcCents).toBe(100);
    expect(after.shadow?.chargedCents).toBe(889);
  });

  test('précédence des règles pays et seuil de gratuité sur le sous-total serveur', async () => {
    const rules = (r: object) => makeDb({ shipping_country_rules: [{ tenant_id: TENANT, active: true, countries: ['IT'], free_shipping_above: null, flat_rate_override: null, discount_type: null, discount_value: null, ...r }] });
    const free = await shadowOf(rules({ free_shipping_above: 99.99 }), { subtotal: 120 });
    expect(free.shadow).toMatchObject({ shadowTtcCents: 0, commercial: { freeShippingApplied: true, theoreticalCents: 840 } });
    const notReached = await shadowOf(rules({ free_shipping_above: 99.99 }), { subtotal: 99.98 });
    expect(notReached.shadow?.shadowTtcCents).toBe(840);
    const override = await shadowOf(rules({ flat_rate_override: 5, discount_type: 'fixed', discount_value: 1 }));
    expect(override.shadow).toMatchObject({ shadowTtcCents: 400, commercial: { overrideApplied: true, afterOverrideCents: 500, discountCents: 100 } });
  });

  test('retrait en magasin : aucune fausse expédition', async () => {
    const db = makeDb();
    const details = await resolveCheckoutShippingDetails(input(db, { fulfillmentType: 'pickup', clientShippingDetails: null, destination: null }));
    expect(details).toBeNull();
    expect(db.log).toHaveLength(0);
  });

  test('échec du calcul : checkout préservé, erreur assainie', async () => {
    const db = makeDb();
    const client = db.client();
    const failing = { from: (t: string) => { if (t === 'shipping_tariff_versions') throw new Error('boom secret=xyz'); return client.from(t); } } as unknown as typeof client;
    const details = await resolveCheckoutShippingDetails(input(db, { supabase: failing }));
    const { shadow_tariff: shadow, ...rest } = details!;
    expect(rest).toEqual(LIVE_DETAILS);
    expect(shadow).toMatchObject({ status: 'error', reasons: ['unexpected_exception'], chargedCents: 889 });
    expect(JSON.stringify(shadow)).not.toContain('secret');
  });

  test('délai dépassé : checkout non bloqué', async () => {
    const hanging = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => new Promise(() => {}) }) }) }) }) }) };
    const details = await resolveCheckoutShippingDetails(input(makeDb(), { supabase: hanging as never, timeoutMs: 20 }));
    expect((details!.shadow_tariff as ShadowTariffRecord)).toMatchObject({ status: 'error', reasons: ['timeout'] });
  });
});

test.describe('devis provider', () => {
  test('vérifié seulement s’il reconstruit le total signé', () => {
    expect(verifyProviderQuote(LIVE_DETAILS, 889).verification).toBe('matches_signed_total');
    expect(verifyProviderQuote({ ...LIVE_DETAILS, packlinkCost: 1 }, 889)).toEqual({ verification: 'unverified', quoteTtcCents: null, packagingSurchargeChargedCents: null });
    expect(verifyProviderQuote({ ...LIVE_DETAILS, countryRuleApplied: true }, 889).verification).toBe('unverified');
    expect(verifyProviderQuote(null, 889).verification).toBe('not_available');
  });

  test('devis non vérifié : aucune marge calculée', async () => {
    const { shadow } = await shadowOf(makeDb(), { clientShippingDetails: { ...LIVE_DETAILS, packlinkCost: 0.01 } });
    expect(shadow).toMatchObject({ status: 'complete', provider: { verification: 'unverified' }, comparison: { expectedMarginBeforePackagingCents: null } });
  });
});

test.describe('parcours devis → session de checkout', () => {
  test('token inchangé, montant signé persistant, shadow joint à la session', async () => {
    const secret = 'test-secret';
    const token = signQuote(8.89, 'IT', '20121', secret);
    const verified = verifyQuote(token, secret);
    expect(verified.valid).toBe(true);
    if (!verified.valid) return;
    expect(Object.keys(verified.payload).sort()).toEqual(['c', 'e', 't', 'z']);

    const db = makeDb({ checkout_sessions: [], payment_funnel_logs: [] });
    const shippingDetails = await resolveCheckoutShippingDetails(input(db, { chargedShippingTotal: verified.payload.t }));
    const active = await upsertActiveCheckoutSession({
      supabase: db.client() as never,
      tenantId: TENANT,
      customerId: null,
      payload: {
        email: 'client@example.test', full_name: null, phone: null, fulfillment_type: 'delivery',
        shipping_address: { country: 'IT', postal_code: '20121' }, shipping_details: shippingDetails,
        shipping_total: verified.payload.t, ambassador_discount_amount: 0, items: [], payment_method: 'stripe',
      },
    });
    const session = db.tables.checkout_sessions!.find((s) => s.id === active.id)!;
    expect(session.shipping_total).toBe(8.89);
    // Le webhook Stripe et createOrderFromCheckoutSession copient shipping_details tel quel vers orders.
    expect((session.shipping_details as Record<string, unknown>).shadow_tariff).toMatchObject({ status: 'complete', chargedCents: 889, shadowTtcCents: 840 });
    expect((session.shipping_details as Record<string, unknown>).packlinkCost).toBe(4.83);
  });
});

test.describe('migration 124', () => {
  const sql = readFileSync(join(__dirname, '../../../../supabase/migrations/124_shipping_tariff_versions.sql'), 'utf8');

  test('versions immuables, sans suppression, une seule version shadow par pays', () => {
    expect(sql).toContain('before update on shipping_tariff_versions');
    expect(sql).toMatch(/raise exception 'shipping_tariff_versions % is immutable/);
    expect(sql).toMatch(/grant select, insert, update on shipping_tariff_versions to service_role;/);
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*shipping_tariff_versions/i);
    expect(sql).toContain('on shipping_tariff_versions (tenant_id, country) where status = \'shadow\'');
  });

  test('défaut provider_cost pour tous les tenants existants', () => {
    expect(sql).toMatch(/shipping_pricing_mode text not null default 'provider_cost'/);
  });
});
