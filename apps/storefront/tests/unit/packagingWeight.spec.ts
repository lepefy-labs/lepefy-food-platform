import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Order } from '@lepefy/types';
import {
  bandsFromRows, bandsToRows, distributeAddedWeight, grossParcelWeights, packagingWeightForOrder, parsePackagingWeightBandsInput,
  type PackagingWeightBand,
} from '../../src/lib/shipping/packagingWeight';
import { calculateShipping } from '../../src/lib/shipping/calculateShipping';
import { planTariffParcels } from '../../src/lib/shipping/tariff/tariffQuote';
import { buildShipmentDraftInput } from '../../src/lib/shipping/shipmentDraft/buildDraftInput';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

const BANDS: PackagingWeightBand[] = [
  { minWeightGExclusive: 0, maxWeightGInclusive: 5000, addedWeightG: 500 },
  { minWeightGExclusive: 5000, maxWeightGInclusive: 10000, addedWeightG: 1000 },
  { minWeightGExclusive: 10000, maxWeightGInclusive: 20000, addedWeightG: 1500 },
  { minWeightGExclusive: 20000, maxWeightGInclusive: null, addedWeightG: 2000 },
];

test('la tranche suit le poids net total, limite haute incluse', () => {
  const added = (g: number) => packagingWeightForOrder(g, BANDS);
  expect([1, 5000, 5001, 10000, 10001, 12300, 20000, 20001, 45000].map(added))
    .toEqual([500, 500, 1000, 1000, 1500, 1500, 1500, 2000, 2000]);
  expect(added(0)).toBe(0);
  expect(packagingWeightForOrder(12300, [])).toBe(0);
});

test('répartition au prorata en grammes entiers, somme exacte', () => {
  expect(distributeAddedWeight(1500, [15000, 3000])).toEqual([1250, 250]);
  expect(distributeAddedWeight(1500, [9000, 9000])).toEqual([750, 750]);
  const shares = distributeAddedWeight(2000, [15000, 15000, 15000]);
  expect(shares).toEqual([667, 667, 666]);
  expect(distributeAddedWeight(0, [1000])).toEqual([0]);
});

test('poids brut des colis : la tranche ne se calcule qu’une fois sur le total', () => {
  expect(grossParcelWeights([12300], BANDS)).toEqual([13800]);
  expect(grossParcelWeights([15000, 3000], BANDS)).toEqual([16250, 3250]);
  expect(grossParcelWeights([15000, 10000], BANDS).reduce((a, b) => a + b, 0)).toBe(27000);
  expect(grossParcelWeights([12300], [])).toEqual([12300]);
});

test('lecture de la saisie : bornes déduites, dernière tranche ouverte', () => {
  const parsed = parsePackagingWeightBandsInput([
    { maxWeightG: 5000, addedWeightG: 500 }, { maxWeightG: 10000, addedWeightG: 1000 },
    { maxWeightG: 20000, addedWeightG: 1500 }, { maxWeightG: null, addedWeightG: 2000 },
  ]);
  expect(parsed).toEqual({ ok: true, bands: BANDS });
  expect(parsePackagingWeightBandsInput([])).toEqual({ ok: true, bands: [] });
  for (const invalid of [
    null, {},
    [{ maxWeightG: 5000, addedWeightG: 500 }],
    [{ maxWeightG: 5000, addedWeightG: 500 }, { maxWeightG: 4000, addedWeightG: 500 }, { maxWeightG: null, addedWeightG: 1 }],
    [{ maxWeightG: null, addedWeightG: -1 }],
    [{ maxWeightG: null, addedWeightG: 20001 }],
    [{ maxWeightG: null, addedWeightG: 1.5 }],
    Array.from({ length: 21 }, (_, i) => ({ maxWeightG: i === 20 ? null : (i + 1) * 1000, addedWeightG: 1 })),
  ]) expect(parsePackagingWeightBandsInput(invalid).ok, JSON.stringify(invalid)).toBe(false);
});

test('conversion ligne ↔ tranche, triée', () => {
  const rows = bandsToRows(BANDS);
  expect(bandsFromRows([...rows].reverse())).toEqual(BANDS);
});

test.describe('calculateShipping', () => {
  const PACKAGING = { surcharge_amount: 3, surcharge_mode: 'per_parcel' as const, max_pack_kg: 15, box_length_cm: 40, box_width_cm: 30, box_height_cm: 20 };
  const originalFetch = globalThis.fetch;
  let requestedWeights: string[] = [];

  test.beforeEach(() => {
    requestedWeights = [];
    globalThis.fetch = (async (url: string) => {
      const params = new URL(url).searchParams;
      for (let i = 0; params.has(`packages[${i}][weight]`); i += 1) requestedWeights.push(params.get(`packages[${i}][weight]`)!);
      return new Response(JSON.stringify([{ id: 1, name: 'S', carrier_name: 'C', dropoff: false, service_info: [], price: { base_price: 10, tax_price: 2 } }]), { status: 200 });
    }) as typeof fetch;
  });
  test.afterEach(() => { globalThis.fetch = originalFetch; });

  const quote = (weightG: number, bands?: PackagingWeightBand[]) => calculateShipping({
    cartItems: [{ weight_grams: weightG, quantity: 1 }], from: { country: 'IT', zip_code: '42122' }, to: { country: 'ES', zip_code: '28001' },
    packagingSurcharge: PACKAGING, vatRates: [], packagingWeightBands: bands,
  }, 'key');

  test('envoie le poids brut à Packlink, totalWeightG et le supplément restent nets', async () => {
    const result = await quote(18000, BANDS);
    expect(requestedWeights).toEqual(['9.75', '9.75']);
    expect(result).toMatchObject({ available: true, shippingTotal: 18, _internal: { totalWeightG: 18000, packagingWeightG: 1500, grossWeightG: 19500, numParcels: 2, packagingSurchargeTotal: 6 } });
  });

  test('sans tranche : poids et détails identiques à aujourd’hui', async () => {
    const result = await quote(12300);
    expect(requestedWeights).toEqual(['12.3']);
    if (!result.available) throw new Error('expected a quote');
    expect(result._internal).not.toHaveProperty('packagingWeightG');
    expect(result._internal).not.toHaveProperty('grossWeightG');
  });
});

test.describe('plan de colis et bozza', () => {
  const PROFILES = [
    { id: 'S', name: 'S', box_length_cm: 35, box_width_cm: 25, box_height_cm: 22, active: true, position: 1, is_default: false, suggest_min_weight_g: 0, suggest_max_weight_g: 5000, tare_g: 200 },
    { id: 'M', name: 'M', box_length_cm: 40, box_width_cm: 30, box_height_cm: 30, active: true, position: 2, is_default: true, suggest_min_weight_g: 5000, suggest_max_weight_g: 15000, tare_g: 400 },
  ];

  test('les tranches remplacent la tare ; net et carton inchangés', () => {
    const plan = planTariffParcels(18000, 15000, PROFILES as never, null, BANDS)!;
    expect(plan.map((p) => [p.netG, p.grossG, p.profileId])).toEqual([[15000, 16250, 'M'], [3000, 3250, 'S']]);
  });

  test('sans tranche la tare reste appliquée', () => {
    const plan = planTariffParcels(18000, 15000, PROFILES as never, null)!;
    expect(plan.map((p) => p.grossG)).toEqual([15400, 3200]);
  });

  test('s’applique aussi à la boîte de repli', () => {
    const plan = planTariffParcels(12300, 15000, [], { length: 40, width: 30, height: 20 }, BANDS)!;
    expect(plan[0]).toMatchObject({ netG: 12300, grossG: 13800, profileId: null });
  });

  test('la bozza déclare 13,8 kg pour 12,3 kg nets, totalWeightG reste net', () => {
    const built = buildShipmentDraftInput({
      order: {
        id: '3f2a91c0-0000-4000-8000-000000000001', tenant_id: 't', email: 'client@example.invalid', full_name: 'Awa Diallo', subtotal: 60.9,
        shipping_address: { full_name: 'Awa Diallo', line1: 'Via Roma 1', city: 'Ferrara', postal_code: '44124', country: 'IT', phone: '+393331234567' },
        shipping_details: { totalWeightG: 12300 }, notes: null,
      } as unknown as Order,
      items: [], productWeights: new Map(), profiles: PROFILES as never,
      packaging: { max_pack_kg: 15, box_length_cm: 40, box_width_cm: 30, box_height_cm: 20 },
      packagingWeightBands: BANDS, content: 'Alimenti', currency: 'EUR',
    });
    expect(built).toMatchObject({ ok: true, totalWeightG: 12300 });
    if (!built.ok) throw new Error('expected a draft');
    expect(built.input.parcels.map((p) => p.weightKg)).toEqual([13.8]);
  });
});

test('API : permissions shipping', () => {
  expect(permissionForAdminApi('/api/admin/shipping-packaging-weight', 'GET')).toBe('shipping.view');
  expect(permissionForAdminApi('/api/admin/shipping-packaging-weight', 'PUT')).toBe('shipping.manage');
});

test('table réservée au service role, écriture par RPC', () => {
  const sql = readFileSync(resolve(__dirname, '../../../../supabase/migrations/180_shipping_packaging_weight_bands.sql'), 'utf8');
  expect(sql).toContain('force row level security');
  expect(sql).not.toMatch(/create policy/i);
  expect(sql).toContain('grant select on public.shipping_packaging_weight_bands to service_role');
});
