import { test, expect } from '@playwright/test';
import { estimateShipping, formatHeadroom, priceBreakpoints, type ShippingEstimateInput } from '../../src/lib/shipping/tariff/shippingEstimate';
import { priceFromTariff } from '../../src/lib/shipping/tariff/priceFromTariff';
import { CHLOEFOOD_TARIFF } from './fixtures/chloefoodTariff';

// Fixture bands: 0–5 kg 8,40 · 5–10 kg 10,80 · 10–15 kg 12,60 · 15–20 kg 16,40 · 20–30 kg 19,80 ; blocks of 30 kg at 19,80 ;
// 15 kg parcels ; islands +2,00 € per parcel.
const base = (weightG: number, overrides: Partial<ShippingEstimateInput> = {}): ShippingEstimateInput => ({
  tariff: CHLOEFOOD_TARIFF, weightG, zoneCode: 'IT_MAINLAND', vatRate: 0.22, subtotalCents: 4000, rule: null, ...overrides,
});

test('known mainland zone: price of the band and grams left before the next band, floored to 100 g', () => {
  expect(estimateShipping(base(7200))).toEqual({
    country: 'IT', exact: true, finalCents: 1080, freeShipping: false, freeShippingRemainingCents: null, headroomG: 2800, zoneSurcharge: null,
  });
  expect(estimateShipping(base(7250))?.headroomG).toBe(2700);
  // Less than 100 g left: nothing is said (never « presque plein », never the band limit).
  expect(estimateShipping(base(4950))?.headroomG).toBeNull();
  // Just over a limit: the customer sees the generous margin of the new band, never « vous dépassez ».
  expect(estimateShipping(base(5100))).toMatchObject({ finalCents: 1080, headroomG: 4900 });
});

test('unknown postal code: continental price, island surcharge flagged, margin true for every zone', () => {
  const estimate = estimateShipping(base(7200, { zoneCode: undefined }));
  expect(estimate).toMatchObject({ exact: false, finalCents: 1080, headroomG: 2800, zoneSurcharge: { amountCents: 200, perParcel: true } });
  // Islands pay per parcel: a new parcel at 15 kg raises their price, so the margin stops there for everyone.
  expect(estimateShipping(base(14000, { zoneCode: undefined }))?.headroomG).toBe(1000);
  // Known island: same limit, and the surcharge is already in the price (no separate note).
  expect(estimateShipping(base(14000, { zoneCode: 'IT_SICILY' }))).toMatchObject({ finalCents: 1460, headroomG: 1000, zoneSurcharge: null });
});

test('blocks of 30 kg: the first gram over 30 kg starts a new band after the block', () => {
  expect(estimateShipping(base(29500))).toMatchObject({ finalCents: 1980, headroomG: 500 });
  // 31 kg = one block + 1 kg in the first band: 4 kg left before 35 kg.
  expect(estimateShipping(base(31000))).toMatchObject({ finalCents: 1980 + 840, headroomG: 4000 });
});

test('breakpoints find exactly the margin a gram-by-gram scan of the engine finds', () => {
  expect(priceBreakpoints(CHLOEFOOD_TARIFF, 7200, 30000)).toEqual(expect.arrayContaining([10001, 15001, 20001, 30000, 30001, 35001]));
  const price = (weightG: number, zoneCode: string | null) => {
    const result = priceFromTariff(CHLOEFOOD_TARIFF, { weightG, country: 'IT', zoneCode, vatRate: 0.22 });
    return result.available ? result.totalTtcCents : Infinity;
  };
  for (const zoneCode of ['IT_MAINLAND', 'IT_SICILY']) {
    for (const weightG of [100, 4999, 7200, 14000, 29999, 30000, 44999]) {
      const current = price(weightG, zoneCode);
      let scanned = 1;
      while (price(weightG + scanned, zoneCode) <= current) scanned += 1;
      const expected = Math.floor((scanned - 1) / 100) * 100;
      expect(estimateShipping(base(weightG, { zoneCode }))?.headroomG ?? 0, `${zoneCode} ${weightG} g`).toBe(expected);
    }
  }
});

test('country rules: free shipping hides the weight margin; threshold remaining shown; fixed price has no margin', () => {
  const rule = { countries: ['IT'], free_shipping_above: 60, flat_rate_override: null, discount_type: null, discount_value: null };
  expect(estimateShipping(base(7200, { rule, subtotalCents: 7000 }))).toMatchObject({ finalCents: 0, freeShipping: true, headroomG: null, zoneSurcharge: null });
  expect(estimateShipping(base(7200, { rule, subtotalCents: 5000 }))).toMatchObject({ freeShipping: false, freeShippingRemainingCents: 1000, headroomG: 2800 });
  const fixed = { countries: ['IT'], free_shipping_above: null, flat_rate_override: 9.9, discount_type: null, discount_value: null };
  expect(estimateShipping(base(7200, { rule: fixed }))).toMatchObject({ finalCents: 990, headroomG: null });
});

test('no estimate without a positive integer weight or in a non-deliverable zone', () => {
  expect(estimateShipping(base(0))).toBeNull();
  expect(estimateShipping(base(12.5))).toBeNull();
  expect(estimateShipping(base(7200, { zoneCode: 'IT_EXTRA_CUSTOMS' }))).toBeNull();
});

test('margin label never more precise than 100 g', () => {
  expect(formatHeadroom(600)).toBe('600 g');
  expect(formatHeadroom(2800)).toBe('2,8 kg');
  expect(formatHeadroom(12000)).toBe('12 kg');
});
