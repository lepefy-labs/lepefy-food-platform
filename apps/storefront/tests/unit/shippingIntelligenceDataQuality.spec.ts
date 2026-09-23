import { expect, test } from '@playwright/test';
import type { ShippingPackagingProfileRow, ShippingQuoteObservationRow, ShippingSimulationCampaignItemRow, Tenant } from '@lepefy/types';
import { buildScenarioRequest, compareObservationToRequest } from '../../src/lib/shipping/intelligence/requestIdentity';
import { findReusableObservation, pickReusableObservation } from '../../src/lib/shipping/intelligence/equivalence';
import { chooseOperationalOffer, groupQuoteExecutions } from '../../src/lib/shipping/intelligence/operationalObservation';
import { quoteScenarioAndPersist } from '../../src/lib/shipping/intelligence/quoteScenario';
import { runCampaignBatch } from '../../src/lib/shipping/intelligence/runCampaignBatch';
import { classifyCampaignItem, computeCampaignCoverage, needsResample } from '../../src/lib/shipping/intelligence/campaignCoverage';
import { fetchCampaignItems, loadCampaignCoverage } from '../../src/lib/shipping/intelligence/campaignData';
import { fetchAllPages } from '../../src/lib/shipping/intelligence/pagedQuery';
import { applyTariffDraft, buildCostComparison, buildScenarioBacktestSample, assessScenarioReliability, backtestTariff, orderBacktestRows, packagingCostFor, providerCostTtc, splitParcelsFilled, validateMultiParcelStrategy, withPackagingCost } from '../../src/lib/shipping/intelligence/tariffBacktest';
import { summarizeObservations } from '../../src/lib/shipping/intelligence/observationsSummary';
import { groupByAdministration, resolveAdministrativeGroup, type PostalAdminRow } from '../../src/lib/shipping/intelligence/postalCityLookup';
import { deepAnalysisWeights, initialCoverageWeights } from '../../src/lib/shipping/intelligence/weightPresets';
import { buildCampaignScenarios, countScenarios, splitDestinationsForLimit, validateScenarioMatrix } from '../../src/lib/shipping/intelligence/scenarioMatrix';
import { FakeDb, fakeId } from './helpers/fakeShippingSupabase';
import { isGenericItalianPostalCode, planZoneSentinels, selectSpread } from '../../src/lib/shipping/intelligence/zoneSentinels';
import { selectZonePool } from '../../src/lib/shipping/intelligence/similarity';
import { resolveZoneCodeFromRows } from '../../src/lib/shipping/intelligence/resolveZone';
import { errorReasonFromItemError } from '../../src/lib/shipping/intelligence/campaignErrorReasons';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const DAY = 24 * 60 * 60 * 1000;

const PROFILE: ShippingPackagingProfileRow = {
  id: 'profile-standard', tenant_id: TENANT, name: 'Standard',
  box_length_cm: 40, box_width_cm: 30, box_height_cm: 30, max_weight_g: 15000,
  is_default: true, active: true, position: 0, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

function observationFor(
  request: ReturnType<typeof buildScenarioRequest>,
  overrides: Partial<ShippingQuoteObservationRow> = {},
): ShippingQuoteObservationRow {
  return {
    id: fakeId('obs'),
    tenant_id: TENANT,
    provider: request.provider,
    source: 'synthetic_simulation',
    campaign_id: null,
    origin_country: request.originCountry,
    origin_postal_code: request.originPostalCode,
    destination_country: request.destinationCountry,
    destination_postal_code: request.destinationPostalCode,
    destination_zone_code: 'IT_NORD',
    num_parcels: request.numParcels,
    parcels: request.parcels,
    total_weight_g: request.totalWeightG,
    packaging_profile_id: PROFILE.id,
    service_id: '1',
    carrier: 'BRT',
    service_name: 'Standard',
    base_price: 8,
    tax_price: 1.76,
    total_provider_cost: 9.76,
    eligible: true,
    exclusion_reason: null,
    observed_at: new Date(Date.now() - DAY).toISOString(),
    request_hash: request.requestHash,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function sinceDays(days: number) {
  return new Date(Date.now() - days * DAY).toISOString();
}

// ─── A. Déduplication stricte ──────────────────────────────────────────────

test('two postal codes of the same commercial zone are never equivalent', () => {
  const milan1 = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' } });
  const milan2 = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20122' } });
  expect(milan1.requestHash).not.toBe(milan2.requestHash);

  // Même zone IT_NORD, même poids/colis — mais un autre CAP, même si le hash était forcé.
  const observation = observationFor(milan1, { request_hash: milan2.requestHash });
  expect(compareObservationToRequest(observation, milan2, TENANT)).toBe('destination_postal_code');
  expect(pickReusableObservation([observation], milan2, TENANT, sinceDays(30))).toBeNull();
});

test('the same postal code, weight and parcels reuses a fresh identical quote (cheapest eligible total)', async () => {
  const request = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' } });
  const observedAt = new Date(Date.now() - 2 * DAY).toISOString();
  const cheapBaseExpensiveTotal = observationFor(request, { id: 'obs-a', base_price: 7, tax_price: 4, total_provider_cost: 11, observed_at: observedAt });
  const cheapestTotal = observationFor(request, { id: 'obs-b', base_price: 8, tax_price: 1.5, total_provider_cost: 9.5, observed_at: observedAt });
  const db = new FakeDb({ shipping_quote_observations: [cheapBaseExpensiveTotal, cheapestTotal] });

  const reusable = await findReusableObservation(db.client(), { tenantId: TENANT, request, freshnessWindowDays: 30 });
  expect(reusable?.id).toBe('obs-b');
  expect(db.unscopedQueries('shipping_quote_observations', TENANT)).toHaveLength(0);
});

test('changing parcel dimensions prevents an improper reuse', () => {
  const request = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' } });
  const biggerBox = buildScenarioRequest({
    weightKg: 10, profile: { ...PROFILE, box_height_cm: 45 }, destination: { country: 'IT', postalCode: '20121' },
  });
  expect(biggerBox.requestHash).not.toBe(request.requestHash);

  // Même hash forcé (ligne historique incohérente) : les dimensions stockées divergent → rejet.
  const observation = observationFor(request, { request_hash: biggerBox.requestHash });
  expect(compareObservationToRequest(observation, biggerBox, TENANT)).toBe('parcels');
  expect(pickReusableObservation([observation], biggerBox, TENANT, sinceDays(30))).toBeNull();
});

test('an expired quote does not cover a new scenario', async () => {
  const request = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' } });
  const stale = observationFor(request, { observed_at: new Date(Date.now() - 40 * DAY).toISOString() });
  const db = new FakeDb({ shipping_quote_observations: [stale] });
  expect(await findReusableObservation(db.client(), { tenantId: TENANT, request, freshnessWindowDays: 30 })).toBeNull();
});

test('a quote from another tenant is never reused', async () => {
  const request = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' } });
  const foreign = observationFor(request, { tenant_id: OTHER_TENANT });
  const db = new FakeDb({ shipping_quote_observations: [foreign] });
  expect(await findReusableObservation(db.client(), { tenantId: TENANT, request, freshnessWindowDays: 30 })).toBeNull();
  expect(pickReusableObservation([foreign], request, TENANT, sinceDays(30))).toBeNull();
});

// ─── B. Coût opérationnel ──────────────────────────────────────────────────

test('the chosen service is the lowest total cost among eligible ones only', () => {
  const chosen = chooseOperationalOffer([
    { id: 1, eligible: true, basePrice: 7, taxPrice: 4 },    // 11
    { id: 2, eligible: true, basePrice: 8, taxPrice: 1.5 },  // 9.5
    { id: 3, eligible: false, basePrice: 2, taxPrice: 0 },   // moins cher mais non éligible
  ]);
  expect(chosen?.id).toBe(2);
  expect(chooseOperationalOffer([{ id: 9, eligible: false, basePrice: 1, taxPrice: 0 }])).toBeNull();
});

function packlinkService(id: number, base: number, tax: number, eligible = true) {
  return {
    id, name: `Service ${id}`, carrier_name: `Carrier ${id}`, dropoff: !eligible,
    service_info: [], price: { base_price: base, tax_price: tax },
  };
}

async function withPacklinkResponse<T>(
  services: unknown[] | null | ((url: URL) => Response),
  run: (calls: string[]) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const originalError = console.error;
  const calls: string[] = [];
  console.info = () => undefined;
  console.error = () => undefined;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    if (typeof services === 'function') return services(new URL(String(input)));
    if (services === null) return new Response('boom', { status: 500 });
    return new Response(JSON.stringify(services), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    console.error = originalError;
  }
}

test('several Packlink services persist as offers but form a single measured scenario', async () => {
  const db = new FakeDb();
  const result = await withPacklinkResponse([
    packlinkService(1, 7, 4), packlinkService(2, 8, 1.5), packlinkService(3, 2, 0, false),
  ], () => quoteScenarioAndPersist({
    supabase: db.client(), tenantId: TENANT, packlinkApiKey: 'k', source: 'synthetic_simulation',
    campaignId: 'c1', weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' },
  }));

  const offers = db.tables.shipping_quote_observations ?? [];
  expect(offers).toHaveLength(3);
  expect(result.ok).toBe(true);
  const chosen = offers.find((o) => o.id === (result.ok ? result.chosenObservationId : null));
  expect(chosen?.service_id).toBe('2');

  const executions = groupQuoteExecutions(offers as unknown as ShippingQuoteObservationRow[]);
  expect(executions).toHaveLength(1);
  expect(executions[0]?.chosen?.service_id).toBe('2');
});

test('no eligible service never produces a false successful quote', async () => {
  const db = new FakeDb();
  const result = await withPacklinkResponse([packlinkService(1, 3, 0, false)], () => quoteScenarioAndPersist({
    supabase: db.client(), tenantId: TENANT, packlinkApiKey: 'k', source: 'synthetic_simulation',
    campaignId: 'c1', weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' },
  }));
  expect(result).toMatchObject({ ok: false, reason: 'no_eligible_service', offersPersisted: true });
  // L'offre exclue reste disponible pour l'analyse, avec son motif.
  expect(db.tables.shipping_quote_observations?.[0]).toMatchObject({ eligible: false, exclusion_reason: 'dropoff' });

  const empty = await withPacklinkResponse([], () => quoteScenarioAndPersist({
    supabase: new FakeDb().client(), tenantId: TENANT, packlinkApiKey: 'k', source: 'synthetic_simulation',
    campaignId: 'c1', weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' },
  }));
  expect(empty).toMatchObject({ ok: false, reason: 'no_service' });

  const providerDown = await withPacklinkResponse(null, () => quoteScenarioAndPersist({
    supabase: new FakeDb().client(), tenantId: TENANT, packlinkApiKey: 'k', source: 'synthetic_simulation',
    campaignId: 'c1', weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' },
  }));
  expect(providerDown).toMatchObject({ ok: false, reason: 'provider_error' });
});

// ─── Worker : réemploi vs nouvelle mesure ──────────────────────────────────

const TENANT_ROW = { id: TENANT, shipping_provider: 'packlink', packlink_api_key: 'k' } as unknown as Tenant;

function campaignItem(campaignId: string, postalCode: string, weightKg: number): ShippingSimulationCampaignItemRow {
  return {
    id: fakeId('item'), campaign_id: campaignId, tenant_id: TENANT, status: 'pending',
    scenario: { weightKg, packagingProfileId: PROFILE.id, destination: { country: 'IT', postalCode, zoneCode: 'IT_NORD' } },
    observation_id: null, error: null, attempted_at: null, created_at: '2026-09-01T00:00:00.000Z',
  };
}

test('a reused scenario does not count as a new Packlink measurement', async () => {
  const reusedRequest = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' } });
  const db = new FakeDb({
    shipping_simulation_campaigns: [{
      id: 'camp', tenant_id: TENANT, name: 'C', status: 'queued', created_at: '2026-09-01T00:00:00.000Z',
      scenario_matrix: { weightsKg: [10], packagingProfileIds: [PROFILE.id], destinations: [], freshnessWindowDays: 30 },
    }],
    shipping_simulation_campaign_items: [campaignItem('camp', '20121', 10), campaignItem('camp', '20122', 10)],
    shipping_packaging_profiles: [PROFILE],
    shipping_quote_observations: [observationFor(reusedRequest, { id: 'obs-fresh' })],
  });

  const { result, calls } = await withPacklinkResponse([packlinkService(5, 8, 1)], async (calls) => ({
    result: await runCampaignBatch(db.client(), TENANT_ROW, { itemsPerTick: 10 }),
    calls,
  }));

  expect(result).toMatchObject({ processed: 2, succeeded: 1, skipped: 1, failed: 0 });
  expect(calls).toHaveLength(1); // seul le CAP 20122 a déclenché un appel provider
  const items = db.tables.shipping_simulation_campaign_items as unknown as ShippingSimulationCampaignItemRow[];
  expect(items.find((i) => i.scenario.destination.postalCode === '20121')).toMatchObject({ status: 'skipped_duplicate', observation_id: 'obs-fresh' });
  expect(items.find((i) => i.scenario.destination.postalCode === '20122')?.status).toBe('succeeded');

  for (const table of ['shipping_simulation_campaign_items', 'shipping_quote_observations', 'shipping_packaging_profiles', 'shipping_simulation_campaigns']) {
    const unscoped = db.unscopedQueries(table, TENANT).filter((q) => q.action !== 'insert');
    expect(unscoped, `${table} queries must be tenant scoped`).toHaveLength(0);
  }
});

// ─── C. Couverture par CAP ─────────────────────────────────────────────────

test('a historical reuse pointing to another postal code is not valid coverage', () => {
  const other = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' } });
  const wrongReuse = observationFor(other, { id: 'obs-other' });
  const item = { ...campaignItem('camp', '20122', 10), status: 'skipped_duplicate' as const, observation_id: 'obs-other', attempted_at: new Date().toISOString() };

  expect(classifyCampaignItem(item, wrongReuse, PROFILE, TENANT, 30).cls).toBe('reused_other_postal_code');

  // Historique « équivalent » par tolérance de poids (10,3 kg vs 10 kg) : incompatible aussi.
  const nearWeight = observationFor(buildScenarioRequest({ weightKg: 10.3, profile: PROFILE, destination: { country: 'IT', postalCode: '20122' } }), { id: 'obs-near' });
  const nearItem = { ...item, observation_id: 'obs-near' };
  expect(classifyCampaignItem(nearItem, nearWeight, PROFILE, TENANT, 30).cls).toBe('reused_incompatible');

  const coverage = computeCampaignCoverage({
    tenantId: TENANT,
    items: [item],
    observationsById: new Map([[wrongReuse.id, wrongReuse]]),
    profilesById: new Map([[PROFILE.id, PROFILE]]),
    destinations: [{ country: 'IT', postalCode: '20122', label: 'Milano · 20122' }],
    freshnessWindowDays: 30,
  });
  expect(coverage.summary.completePostalCodes).toBe(0);
  expect(coverage.summary.incompatible).toBe(1);
  expect(coverage.summary.resampleCandidates).toBe(1);
  expect(coverage.rows[0]).toMatchObject({ status: 'incompatible', city: 'Milano', coveredWeightsKg: [] });
});

test('a postal code is complete only when every scenario has a valid quote', () => {
  const r10 = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '00118' } });
  const r20 = buildScenarioRequest({ weightKg: 20, profile: PROFILE, destination: { country: 'IT', postalCode: '00118' } });
  const quoted = observationFor(r10, { id: 'o10', campaign_id: 'camp' });
  const reused = observationFor(r20, { id: 'o20' });
  const items = [
    { ...campaignItem('camp', '00118', 10), status: 'succeeded' as const, observation_id: 'o10', attempted_at: new Date().toISOString() },
    { ...campaignItem('camp', '00118', 20), status: 'skipped_duplicate' as const, observation_id: 'o20', attempted_at: new Date().toISOString() },
    campaignItem('camp', '00119', 10),
  ];
  const coverage = computeCampaignCoverage({
    tenantId: TENANT, items,
    observationsById: new Map([[quoted.id, quoted], [reused.id, reused]]),
    profilesById: new Map([[PROFILE.id, PROFILE]]),
    destinations: [], freshnessWindowDays: 30,
  });
  expect(coverage.summary).toMatchObject({ plannedPostalCodes: 2, completePostalCodes: 1, newQuotes: 1, validReuses: 1, remaining: 1 });
  // Zéros initiaux préservés.
  expect(coverage.postalCodes.map((p) => p.postalCode)).toEqual(['00118', '00119']);
});

test('coverage counts stay exact beyond 1000 items and stay tenant scoped', async () => {
  const items: ShippingSimulationCampaignItemRow[] = [];
  const observations: ShippingQuoteObservationRow[] = [];
  for (let i = 0; i < 1500; i++) {
    const postalCode = String(20100 + (i % 50));
    const weightKg = 1 + Math.floor(i / 50);
    const item = campaignItem('camp', postalCode, weightKg);
    if (i % 3 === 0) {
      const obs = observationFor(buildScenarioRequest({ weightKg, profile: PROFILE, destination: { country: 'IT', postalCode } }), { campaign_id: 'camp' });
      observations.push(obs);
      Object.assign(item, { status: 'succeeded', observation_id: obs.id, attempted_at: new Date().toISOString() });
    }
    items.push(item);
  }
  // Bruit d'un autre tenant : même campagne-id, jamais compté.
  items.push({ ...campaignItem('camp', '20100', 1), tenant_id: OTHER_TENANT });

  const db = new FakeDb({
    shipping_simulation_campaign_items: items,
    shipping_quote_observations: observations,
    shipping_packaging_profiles: [PROFILE],
  });

  const fetched = await fetchCampaignItems(db.client(), TENANT, 'camp');
  expect(fetched.rows).toHaveLength(1500);

  const coverage = await loadCampaignCoverage(db.client(), TENANT, {
    id: 'camp', tenant_id: TENANT, scenario_matrix: { weightsKg: [], packagingProfileIds: [PROFILE.id], destinations: [] },
  } as never);
  expect(coverage.summary.plannedScenarios).toBe(1500);
  expect(coverage.summary.newQuotes).toBe(500);
  expect(coverage.summary.pending).toBe(1000);
  expect(coverage.summary.plannedPostalCodes).toBe(50);

  for (const table of ['shipping_simulation_campaign_items', 'shipping_quote_observations', 'shipping_packaging_profiles']) {
    expect(db.unscopedQueries(table, TENANT), `${table} queries must be tenant scoped`).toHaveLength(0);
  }
});

test('an observation belonging to another tenant never covers a scenario', () => {
  const request = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' } });
  const foreign = observationFor(request, { tenant_id: OTHER_TENANT, campaign_id: 'camp' });
  const item = { ...campaignItem('camp', '20121', 10), status: 'succeeded' as const, observation_id: foreign.id };
  expect(classifyCampaignItem(item, foreign, PROFILE, TENANT, 30).cls).toBe('unverifiable');
  expect(classifyCampaignItem(item, undefined, PROFILE, TENANT, 30).cls).toBe('observation_missing');
});

test('paged reads never stop at the 1000-row server cap', async () => {
  const all = Array.from({ length: 2345 }, (_, i) => i);
  const result = await fetchAllPages<number>(async (from, to) => ({ data: all.slice(from, Math.min(to + 1, from + 1000)), error: null }));
  expect(result.rows).toHaveLength(2345);
  expect(result.truncated).toBe(false);
});

// ─── D. Échantillonnage progressif ─────────────────────────────────────────

test('initial coverage uses about six capacity-aware weights; deep analysis is denser near steps', () => {
  expect(initialCoverageWeights(15)).toEqual([1, 3, 7.5, 14.5, 15.5, 30]);
  const deep = deepAnalysisWeights(15);
  expect(deep.length).toBeGreaterThan(initialCoverageWeights(15).length * 3);
  for (const threshold of [15, 30, 45]) {
    expect(deep).toEqual(expect.arrayContaining([threshold - 0.5, threshold, threshold + 0.5]));
  }
});

test('per-profile weights drive the matrix and an oversized selection is split deterministically', () => {
  const matrix = {
    weightsKg: [],
    weightsByProfileId: { a: [1, 2, 3], b: [1, 2] },
    packagingProfileIds: ['a', 'b'],
    destinations: Array.from({ length: 500 }, (_, i) => ({ country: 'IT', postalCode: String(10000 + i).padStart(5, '0') })),
  };
  expect(buildCampaignScenarios({ ...matrix, destinations: matrix.destinations.slice(0, 1) })).toHaveLength(5);
  expect(countScenarios(matrix)).toBe(2500);
  expect(validateScenarioMatrix(matrix)).toContain('500 CAP × 5 scénario(s) par CAP');

  const parts = splitDestinationsForLimit([...matrix.destinations].reverse(), 5);
  expect(parts).toHaveLength(2);
  expect(parts.flat()).toHaveLength(500); // aucun CAP supprimé
  expect(parts.every((p) => p.length * 5 <= 2000)).toBe(true);
  expect(parts[0]?.[0]?.postalCode).toBe('10000');
});

// ─── E. Désambiguïsation géographique ──────────────────────────────────────

const HOMONYMS: PostalAdminRow[] = [
  { place_name: 'Castelnuovo', admin_name1: 'Toscana', admin_code1: '16', admin_name2: 'Arezzo', admin_code2: 'AR', postal_code: '52010' },
  { place_name: 'Castelnuovo', admin_name1: 'Trentino-Alto Adige', admin_code1: '17', admin_name2: 'Trento', admin_code2: 'TN', postal_code: '38050' },
  { place_name: 'Castelnuovo', admin_name1: 'Trentino-Alto Adige', admin_code1: '17', admin_name2: 'Trento', admin_code2: 'TN', postal_code: '38051' },
];

test('two homonymous communes with different administrations never share postal codes', () => {
  const groups = groupByAdministration(HOMONYMS, 'IT');
  expect(groups).toHaveLength(2);

  const unresolved = resolveAdministrativeGroup(groups, {});
  expect(unresolved.status).toBe('ambiguous');

  // Codes Nominatim : région ISO « 32 » (≠ GeoNames « 17 ») mais province « TN » concordante.
  const nominatim = resolveAdministrativeGroup(groups, { stateCodes: ['TN', '32'] });
  expect(nominatim).toMatchObject({ status: 'resolved', matchedBy: 'state_codes' });
  expect(nominatim.status === 'resolved' ? nominatim.group.postalCodes : []).toEqual(['38050', '38051']);

  const exact = resolveAdministrativeGroup(groups, { exact: { adminCode1: '16', adminCode2: 'AR' } });
  expect(exact.status === 'resolved' ? exact.group.postalCodes : []).toEqual(['52010']);

  // Conventions incompatibles et plusieurs communes : jamais de fusion.
  expect(resolveAdministrativeGroup(groups, { stateCodes: ['XX'] }).status).toBe('ambiguous');
});

test('leading zeros survive geographic resolution', () => {
  const groups = groupByAdministration([
    { place_name: 'Bourg-en-Bresse', admin_name1: 'Auvergne-Rhône-Alpes', admin_code1: '84', admin_name2: 'Ain', admin_code2: '01', postal_code: '01000' },
  ], 'FR');
  const resolved = resolveAdministrativeGroup(groups, { stateCodes: ['ARA', '01'] });
  expect(resolved.status === 'resolved' ? resolved.group.postalCodes : []).toEqual(['01000']);
});

// ─── F. Rétrotest ──────────────────────────────────────────────────────────

test('the backtest does not inflate the sample with alternative offers or repeated executions', () => {
  const request = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' } });
  const older = new Date(Date.now() - 5 * DAY).toISOString();
  const newer = new Date(Date.now() - DAY).toISOString();
  const offers = [
    observationFor(request, { observed_at: older, total_provider_cost: 12 }),
    observationFor(request, { observed_at: older, total_provider_cost: 15 }),
    observationFor(request, { observed_at: newer, total_provider_cost: 10 }),
    observationFor(request, { observed_at: newer, total_provider_cost: 18 }),
    observationFor(request, { observed_at: newer, total_provider_cost: 25 }),
  ];
  const sample = buildScenarioBacktestSample(offers);
  expect(sample.rows).toHaveLength(1);
  expect(sample.rows[0]?.providerCost).toBe(10); // dernière exécution, service le moins cher
  expect(sample.stats).toMatchObject({ offersRead: 5, executions: 2, scenarios: 1, alternativeOffersExcluded: 3, olderExecutionsExcluded: 1, postalCodes: 1 });
  expect(assessScenarioReliability(sample.stats)).toBe('insufficient');

  const metrics = backtestTariff([{ minKg: 0, maxKg: 15, price: 11 }], {}, null, sample.rows);
  expect(metrics.sampleSize).toBe(1);
  expect(metrics.negativeMarginPct).toBe(0);
});

test('a large sample concentrated in few postal codes is flagged as limited coverage', () => {
  const offers = Array.from({ length: 40 }, (_, i) => observationFor(
    buildScenarioRequest({ weightKg: 1 + i, profile: PROFILE, destination: { country: 'IT', postalCode: i < 30 ? '20121' : `2013${i % 10}` } }),
  ));
  const sample = buildScenarioBacktestSample(offers);
  expect(sample.stats.scenarios).toBe(40);
  expect(assessScenarioReliability(sample.stats)).toBe('limited');
});

test('the cost history summary counts measured scenarios, not provider offers', () => {
  const request = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '20121' } });
  const at = new Date(Date.now() - DAY).toISOString();
  const offers = [9, 11, 14].map((cost) => observationFor(request, { observed_at: at, total_provider_cost: cost }));
  const { scenariosMeasured, groups } = summarizeObservations(offers, new Map([[PROFILE.id, PROFILE.name]]));
  expect(scenariosMeasured).toBe(1);
  expect(groups[0]).toMatchObject({ sampleSize: 1, medianCost: 9, postalCodes: 1, confidence: 'low' });
});

// ─── Refus de destination Packlink vs incident ─────────────────────────────

function packlinkByZip(rejected: string[]) {
  return (url: URL) => {
    const zip = url.searchParams.get('to[zip]') ?? '';
    if (rejected.includes(zip)) return new Response('{"messages":[{"message":"Bad Request"}]}', { status: 400 });
    return new Response(JSON.stringify([packlinkService(7, 8, 1)]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('a Packlink 400 is a rejected destination, not an infrastructure incident', async () => {
  const rejected = await withPacklinkResponse(packlinkByZip(['41100']), () => quoteScenarioAndPersist({
    supabase: new FakeDb().client(), tenantId: TENANT, packlinkApiKey: 'k', source: 'synthetic_simulation',
    campaignId: 'c1', weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '41100' },
  }));
  expect(rejected).toMatchObject({ ok: false, reason: 'provider_rejected', offersPersisted: false });

  const outage = await withPacklinkResponse(() => new Response('down', { status: 503 }), () => quoteScenarioAndPersist({
    supabase: new FakeDb().client(), tenantId: TENANT, packlinkApiKey: 'k', source: 'synthetic_simulation',
    campaignId: 'c1', weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '41121' },
  }));
  expect(outage).toMatchObject({ ok: false, reason: 'provider_error' });
});

test('the worker reports rejected CAPs separately and stops calling them after two weights', async () => {
  const items = [1, 3, 7.5, 14.5].map((w) => campaignItem('camp', '41100', w)).concat([campaignItem('camp', '41121', 1)]);
  const db = new FakeDb({
    shipping_simulation_campaigns: [{
      id: 'camp', tenant_id: TENANT, name: 'C', status: 'queued', created_at: '2026-09-01T00:00:00.000Z',
      scenario_matrix: { weightsKg: [], packagingProfileIds: [PROFILE.id], destinations: [], freshnessWindowDays: 30 },
    }],
    shipping_simulation_campaign_items: items,
    shipping_packaging_profiles: [PROFILE],
  });

  // Premier lot : deux poids refusés pour 41100 → la destination est prouvée refusée.
  const first = await withPacklinkResponse(packlinkByZip(['41100']), async (calls) => ({
    result: await runCampaignBatch(db.client(), TENANT_ROW, { itemsPerTick: 2 }),
    calls: calls.length,
  }));
  expect(first.result).toMatchObject({ processed: 2, failed: 0, rejected: 2 });
  expect(first.calls).toBe(2);

  // Lot suivant : les poids restants de 41100 sont clos sans appel ; 41121 est mesuré.
  const second = await withPacklinkResponse(packlinkByZip(['41100']), async (calls) => ({
    result: await runCampaignBatch(db.client(), TENANT_ROW, { itemsPerTick: 10 }),
    calls: calls.map((c) => new URL(c).searchParams.get('to[zip]')),
  }));
  expect(second.result).toMatchObject({ processed: 3, succeeded: 1, failed: 0, rejected: 2 });
  expect(second.calls).toEqual(['41121']);

  const stored = db.tables.shipping_simulation_campaign_items as unknown as ShippingSimulationCampaignItemRow[];
  expect(stored.filter((i) => i.error === 'provider_rejected_known_destination')).toHaveLength(2);
  expect(db.unscopedQueries('shipping_simulation_campaign_items', TENANT).filter((q) => q.action !== 'insert')).toHaveLength(0);
});

test('the error diagnostic explains each reason and excludes deterministic refusals from resampling', () => {
  expect(errorReasonFromItemError('packlink_error')).toBe('legacy_packlink_error');
  expect(errorReasonFromItemError('persistence_error: timeout')).toBe('persistence_error');
  expect(errorReasonFromItemError('boom')).toBe('unexpected_error');

  const failedItem = (postalCode: string, weightKg: number, error: string) => ({
    ...campaignItem('camp', postalCode, weightKg), status: 'failed' as const, error, attempted_at: new Date().toISOString(),
  });
  const items = [
    failedItem('41100', 1, 'provider_rejected'),
    failedItem('41100', 3, 'provider_rejected_known_destination'),
    failedItem('41121', 1, 'provider_error'),
    failedItem('41122', 1, 'no_eligible_service'),
    failedItem('43100', 1, 'packlink_error'),
  ];
  const coverage = computeCampaignCoverage({
    tenantId: TENANT, items, observationsById: new Map(), profilesById: new Map([[PROFILE.id, PROFILE]]),
    destinations: [], freshnessWindowDays: 30,
  });

  const byCode = Object.fromEntries(coverage.summary.errorBreakdown.map((e) => [e.code, e]));
  expect(byCode.provider_rejected).toMatchObject({ scenarios: 1, postalCodes: ['41100'], resample: false });
  expect(byCode.provider_error).toMatchObject({ scenarios: 1, resample: true });
  expect(byCode.no_eligible_service).toMatchObject({ resample: false });
  expect(byCode.legacy_packlink_error).toMatchObject({ postalCodes: ['43100'], resample: true });
  expect(coverage.summary.resampleCandidates).toBe(2);
  expect(coverage.summary.rejected).toBe(2);
  expect(coverage.summary.rejectedPostalCodes).toBe(1);
  expect(coverage.postalCodes.find((p) => p.postalCode === '41100')?.status).toBe('rejected');

  const resampled = items.filter((i) => needsResample(coverage.classifications.get(i.id)!)).map((i) => i.scenario.destination.postalCode);
  expect(resampled.sort()).toEqual(['41121', '43100']);
});

// ─── Lot du worker borné en temps ──────────────────────────────────────────

test('the worker stops claiming items once the tick time budget is spent', async () => {
  const items = Array.from({ length: 10 }, (_, i) => campaignItem('camp', String(41121 + (i % 5)), 1 + i));
  const db = new FakeDb({
    shipping_simulation_campaigns: [{
      id: 'camp', tenant_id: TENANT, name: 'C', status: 'running', created_at: '2026-09-01T00:00:00.000Z',
      scenario_matrix: { weightsKg: [], packagingProfileIds: [PROFILE.id], destinations: [], freshnessWindowDays: 30 },
    }],
    shipping_simulation_campaign_items: items,
    shipping_packaging_profiles: [PROFILE],
  });

  // Horloge simulée : chaque lecture avance de 4 s → le budget de 30 s est
  // atteint après quelques items, les autres restent pending.
  let clock = 0;
  const now = () => { clock += 4_000; return clock; };
  const result = await withPacklinkResponse([packlinkService(5, 8, 1)], () =>
    runCampaignBatch(db.client(), TENANT_ROW, { itemsPerTick: 40, timeBudgetMs: 30_000, now }));

  const stored = db.tables.shipping_simulation_campaign_items as unknown as ShippingSimulationCampaignItemRow[];
  expect(result.processed).toBeGreaterThan(0);
  expect(result.processed).toBeLessThan(10);
  expect(result.failed).toBe(0);
  expect(stored.filter((i) => i.status === 'pending')).toHaveLength(10 - result.processed);
  expect(stored.some((i) => i.status === 'running')).toBe(false);
});

// ─── Couverture par zone (CAP témoins) ─────────────────────────────────────

function zoneRow(code: string, prefixes: string[], position = 0) {
  return {
    id: code, tenant_id: TENANT, code, country: 'IT', postal_prefixes: prefixes, active: true, position,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  };
}

test('generic pre-reform CAPs are detected only when the city has split codes', () => {
  const counts = new Map([['401', 3], ['211', 1]]);
  expect(isGenericItalianPostalCode('40100', counts)).toBe(true);
  expect(isGenericItalianPostalCode('21100', counts)).toBe(false); // Varese : 21100 reste valide
  expect(isGenericItalianPostalCode('40121', counts)).toBe(false);
});

test('zone sentinels are deterministic, spread, and skip generic or rejected CAPs', () => {
  const zones = [
    zoneRow('IT_EMILIA_ROMAGNA', ['40', '41'], 1),
    zoneRow('IT_CAMPANIA', ['80'], 2),
    zoneRow('IT_MINOR_ISLANDS', ['80073'], 3),
  ];
  const codes = ['40100', '40121', '40122', '40123', '40124', '41121', '80121', '80122', '80073', '90121'];
  const cityOf = (code: string) => (code.startsWith('401') ? 'Bologna' : code.startsWith('801') ? 'Napoli' : `Ville ${code}`);
  // GeoNames : un même CAP peut porter une frazione ; le libellé retenu est la ville.
  const candidates = [...codes.map((postalCode) => ({ postalCode, city: cityOf(postalCode), adminCode2: null })), { postalCode: '40121', city: 'Frazione', adminCode2: null }];
  const plan = planZoneSentinels({ country: 'IT', zones, candidates, perZone: 2, rejectedPostalCodes: new Set(['40122']) });

  const byZone: Record<string, (typeof plan)[number]> = Object.fromEntries(plan.map((p) => [p.zoneCode ?? '', p]));
  expect(plan.map((p) => p.zoneCode)).toEqual(['IT_EMILIA_ROMAGNA', 'IT_CAMPANIA', 'IT_MINOR_ISLANDS']);
  expect(byZone.IT_EMILIA_ROMAGNA).toMatchObject({ candidates: 4, excludedGeneric: 1, excludedRejected: 1 });
  expect(byZone.IT_EMILIA_ROMAGNA!.sentinels.map((s) => s.postalCode)).toEqual(['40123', '41121']); // CAP médian de Bologna (ville principale) + une autre localité
  expect(byZone.IT_EMILIA_ROMAGNA!.sentinels[0]!.city).toBe('Bologna');
  // Préfixe le plus spécifique : 80073 (Capri) relève des îles mineures, pas de la Campanie.
  expect(byZone.IT_MINOR_ISLANDS!.sentinels.map((s) => s.postalCode)).toEqual(['80073']);
  expect(byZone.IT_CAMPANIA!.sentinels.map((s) => s.postalCode)).toEqual(['80121', '80122']);
  // 90121 : hors zones actives, exclu par défaut.
  expect(plan.some((p) => p.zoneCode === null)).toBe(false);
  // Même entrée → même sortie.
  expect(planZoneSentinels({ country: 'IT', zones, candidates, perZone: 2, rejectedPostalCodes: new Set(['40122']) })).toEqual(plan);
  expect(selectSpread([1, 2, 3, 4, 5, 6, 7, 8], 2)).toEqual([3, 7]);
});

test('the advisor estimates strictly by zone, resolving legacy observations from their CAP', () => {
  const zones = [zoneRow('IT_LOMBARDY', ['20']), zoneRow('IT_SICILY', ['90'])];
  const rows = [
    { destination_postal_code: '20121', destination_zone_code: null }, // ancienne observation sans zone
    { destination_postal_code: '20122', destination_zone_code: 'IT_LOMBARDY' },
  ];
  expect(selectZonePool(rows, 'IT', 'IT_LOMBARDY', zones)).toHaveLength(2);
  // Aucune donnée sicilienne : jamais les prix du continent.
  expect(selectZonePool(rows, 'IT', 'IT_SICILY', zones)).toHaveLength(0);
});

test('the backtest applies zone surcharges from the CAP even when the stored zone is missing', () => {
  const request = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '90121' } });
  const offers = [observationFor(request, { destination_zone_code: null, total_provider_cost: 10 })];
  const zones = [zoneRow('IT_SICILY', ['90'])];
  const sample = buildScenarioBacktestSample(offers, (country, postal) => resolveZoneCodeFromRows(zones, country, postal));
  expect(sample.rows[0]?.zoneCode).toBe('IT_SICILY');
  const metrics = backtestTariff([{ minKg: 0, maxKg: 15, price: 9 }], { IT_SICILY: 2 }, null, sample.rows);
  expect(metrics.avgMargin).toBe(1);
  expect(assessScenarioReliability({ scenarios: 60, postalCodes: 6, topPostalCodeShare: 0.2, zones: 3 })).toBe('indicative');
  expect(assessScenarioReliability({ scenarios: 60, postalCodes: 6, topPostalCodeShare: 0.2, zones: 2 })).toBe('limited');
});

// ─── Rétrotest : base TTC et pays ──────────────────────────────────────────

test('the backtest compares customer TTC prices with Packlink quotes plus VAT, for the draft country only', () => {
  // Packlink renvoie des devis HT (tax_price = 0) : la TVA du pays est ajoutée.
  expect(providerCostTtc(7.89, 0, 0.22)).toBe(9.63);
  // Si Packlink renvoyait la taxe, le total est déjà TTC.
  expect(providerCostTtc(9.63, 1.74, 0.22)).toBe(9.63);

  const request = buildScenarioRequest({ weightKg: 10, profile: PROFILE, destination: { country: 'IT', postalCode: '40131' } });
  const sample = buildScenarioBacktestSample([observationFor(request, { total_provider_cost: 7.89, tax_price: 0 })], undefined, () => 0.22);
  expect(sample.rows[0]?.providerCost).toBe(9.63);
  const metrics = backtestTariff([{ minKg: 0, maxKg: 15, price: 8.9 }], {}, null, sample.rows);
  expect(metrics.avgMargin).toBe(-0.73); // marge HT apparente +1,01 → réellement à perte en TTC
  expect(metrics.maxLoss).toBe(-0.73);
  expect(backtestTariff([{ minKg: 0, maxKg: 15, price: 10.9 }], {}, null, sample.rows)).toMatchObject({ maxLoss: 0, minMargin: 1.27 });

  const orders = orderBacktestRows([
    { shipping_details: { packlinkCost: 5.42, vatAmount: 1.19, packagingSurchargeTotal: 3, totalWeightG: 2100, numParcels: 1 }, shipping_address: { country: 'IT' } },
    { shipping_details: { packlinkCost: 10.44, vatAmount: 2.3, totalWeightG: 900, numParcels: 1 }, shipping_address: { country: 'BE' } },
  ], 'IT');
  expect(orders).toEqual([{ providerCost: 6.61, packagingCost: 3, weightKg: 2.1, zoneCode: null, numParcels: 1 }]);
  // Coût réel de la commande = ce que le client a payé (9,61 €).
  expect(withPackagingCost(orders)[0]!.providerCost).toBe(9.61);
});

// ─── Colis supplémentaires & coût réel (Packlink TTC + emballage) ──────────

const TENANT_BANDS = [{ minKg: 0, maxKg: 10, price: 10.5 }, { minKg: 10, maxKg: 15, price: 12.5 }];

test('per-parcel pricing: first parcel at its band, extra parcels at their band minus the discount', () => {
  const pct = { type: 'first_parcel_plus_percentage' as const, percentageDiscount: 50, parcelMaxKg: 15 };
  const price = (weightKg: number) => applyTariffDraft(TENANT_BANDS, {}, pct, { weightKg, zoneCode: null, numParcels: 1 });
  expect(splitParcelsFilled(20, 15)).toEqual([15, 5]);
  expect(price(8)).toBe(10.5);
  expect(price(12)).toBe(12.5);
  expect(price(20)).toBe(17.75); // 12,50 + 50 % × 10,50
  expect(price(30)).toBe(18.75); // 12,50 + 50 % × 12,50
  expect(price(45)).toBe(25);    // 12,50 + 2 × 6,25
  // Surcharge de zone : une fois par commande.
  expect(applyTariffDraft(TENANT_BANDS, { IT_SICILY: 1 }, pct, { weightKg: 20, zoneCode: 'IT_SICILY', numParcels: 2 })).toBe(18.75);

  const fixed = { type: 'first_parcel_plus_discounted' as const, discountedParcelRate: 6.25, parcelMaxKg: 15 };
  expect(applyTariffDraft(TENANT_BANDS, {}, fixed, { weightKg: 20, zoneCode: null, numParcels: 2 })).toBe(18.75);
  // Sans stratégie, une bande manquante au-delà de 15 kg reste « hors bandes ».
  expect(applyTariffDraft(TENANT_BANDS, {}, null, { weightKg: 20, zoneCode: null, numParcels: 2 })).toBeNull();
});

test('multi-parcel strategies are validated server-side', () => {
  expect(validateMultiParcelStrategy(null)).toBeNull();
  expect(validateMultiParcelStrategy({ type: 'first_parcel_plus_percentage', percentageDiscount: '50', parcelMaxKg: 15 }))
    .toEqual({ type: 'first_parcel_plus_percentage', percentageDiscount: 50, parcelMaxKg: 15 });
  expect(validateMultiParcelStrategy({ type: 'first_parcel_plus_percentage', percentageDiscount: 150, parcelMaxKg: 15 })).toBe('invalid');
  expect(validateMultiParcelStrategy({ type: 'first_parcel_plus_percentage', percentageDiscount: 50 })).toBe('invalid');
  expect(validateMultiParcelStrategy({ type: 'unknown' })).toBe('invalid');
});

test('the real cost includes current packaging and the comparison flags uncovered cases', () => {
  const packaging = { surcharge_amount: 3, surcharge_mode: 'per_parcel' };
  expect(packagingCostFor(2, packaging)).toBe(6);
  expect(packagingCostFor(2, { surcharge_amount: 3, surcharge_mode: 'per_order' })).toBe(3);

  const rows = [
    { providerCost: 7.2, weightKg: 1, zoneCode: 'IT_LOMBARDY', numParcels: 1, packagingCost: 3 },
    { providerCost: 11.21, weightKg: 7.5, zoneCode: 'IT_SICILY', numParcels: 1, packagingCost: 3 },
    { providerCost: 8.3, weightKg: 7.5, zoneCode: 'IT_LOMBARDY', numParcels: 1, packagingCost: 3 },
  ];
  expect(withPackagingCost(rows)[0]!.providerCost).toBe(10.2);

  const comparison = buildCostComparison(rows, TENANT_BANDS, {}, null);
  expect(comparison.map((r) => r.weightKg)).toEqual([1, 7.5]);
  const cell = comparison[1]!.cells[0]!;
  expect(cell).toMatchObject({ zoneSurcharge: 0, scenarios: 2, realCostMedian: 12.76, realCostMax: 14.21, forfait: 10.5, typicalGap: -2.26, worstGap: -3.71 });
  expect(backtestTariff(TENANT_BANDS, {}, null, withPackagingCost(rows))).toMatchObject({ negativeMarginPct: 66.7 });
});
