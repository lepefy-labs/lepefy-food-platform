import { expect, test } from '@playwright/test';
import type { ShippingTariffVersionRow } from '@lepefy/types';
import {
  applyCommercialRulesCents,
  priceFromTariff,
  type TariffSnapshot,
} from '../../src/lib/shipping/tariff/priceFromTariff';
import { buildVersionFromDraft, parseTariffVersion, validateTariffFields } from '../../src/lib/shipping/tariff/tariffVersion';
import { applyCountryRule, type ShippingCountryRule } from '../../src/lib/shipping/resolveCountryRule';
import { CHLOEFOOD_TARIFF } from './fixtures/chloefoodTariff';

function price(weightG: number, zoneCode: string | null = null, tariff = CHLOEFOOD_TARIFF, vatRate: number | null = 0.22) {
  const r = priceFromTariff(tariff, { weightG, country: 'IT', zoneCode, vatRate });
  if (!r.available) throw new Error(`unavailable: ${r.reason}`);
  return r;
}

test.describe('priceFromTariff — fasce e confini', () => {
  test('5 000 g nella prima fascia, 5 001 g nella seconda', () => {
    expect(price(5000).totalTtcCents).toBe(840);
    expect(price(5001).totalTtcCents).toBe(1080);
    expect(price(1).totalTtcCents).toBe(840);
  });

  test('15 / 15,001 / 20 / 30 kg', () => {
    expect(price(15000).totalTtcCents).toBe(1260);
    expect(price(15001).totalTtcCents).toBe(1640);
    expect(price(20000).totalTtcCents).toBe(1640);
    expect(price(30000).totalTtcCents).toBe(1980);
    expect(price(30000).blocks).toBe(0);
  });

  test('blocchi oltre 30 kg: 30,001 / 45 / 60 / 90 kg', () => {
    const p30001 = price(30001);
    expect(p30001.blocks).toBe(1);
    expect(p30001.remainderWeightG).toBe(1);
    expect(p30001.band?.priceCents).toBe(840);
    expect(p30001.totalTtcCents).toBe(1980 + 840);
    expect(price(45000).totalTtcCents).toBe(3240);
    expect(price(60000).totalTtcCents).toBe(3960);
    expect(price(60000).band).toBeNull();
    expect(price(90000).totalTtcCents).toBe(5940);
    expect(price(90000).blocks).toBe(3);
  });

  test('senza regola a blocchi, oltre l’ultima fascia → band_not_covered', () => {
    const r = priceFromTariff({ ...CHLOEFOOD_TARIFF, blockWeightG: null, blockPriceCents: null }, { weightG: 30001, country: 'IT', zoneCode: null });
    expect(r).toMatchObject({ available: false, reason: 'band_not_covered' });
  });

  test('peso non intero o nullo rifiutato', () => {
    expect(priceFromTariff(CHLOEFOOD_TARIFF, { weightG: 0, country: 'IT', zoneCode: null })).toMatchObject({ available: false, reason: 'invalid_weight' });
    expect(priceFromTariff(CHLOEFOOD_TARIFF, { weightG: 1500.5, country: 'IT', zoneCode: null })).toMatchObject({ available: false, reason: 'invalid_weight' });
  });

  test('paese diverso dalla versione', () => {
    expect(priceFromTariff(CHLOEFOOD_TARIFF, { weightG: 1000, country: 'fr', zoneCode: null })).toMatchObject({ available: false, reason: 'country_mismatch' });
    expect(priceFromTariff(CHLOEFOOD_TARIFF, { weightG: 1000, country: ' it ', zoneCode: null }).available).toBe(true);
  });
});

test.describe('priceFromTariff — colli e zone', () => {
  test('piano colli a riempimento progressivo', () => {
    expect(price(5000).parcelsG).toEqual([5000]);
    expect(price(15000).parcelsG).toEqual([15000]);
    expect(price(20000).parcelsG).toEqual([15000, 5000]);
    expect(price(30000).parcelsG).toEqual([15000, 15000]);
    expect(price(45000).numParcels).toBe(3);
  });

  test('maggiorazione per collo', () => {
    const r = price(20000, 'IT_SICILY');
    expect(r.zoneSurcharge).toEqual({ zoneCode: 'IT_SICILY', mode: 'per_parcel', amountCents: 200, totalCents: 400 });
    expect(r.totalTtcCents).toBe(1640 + 400);
    expect(price(5000, 'IT_SICILY').totalTtcCents).toBe(840 + 200);
  });

  test('maggiorazione per ordine', () => {
    const perOrder: TariffSnapshot = { ...CHLOEFOOD_TARIFF, zoneSurcharges: [{ zone_code: 'IT_SICILY', amount_cents: 200, mode: 'per_order' }] };
    expect(price(30000, 'IT_SICILY', perOrder).totalTtcCents).toBe(1980 + 200);
  });

  test('zona senza maggiorazione e zona non consegnabile', () => {
    expect(price(5000, 'IT_LOMBARDIA').zoneSurcharge).toBeNull();
    expect(priceFromTariff(CHLOEFOOD_TARIFF, { weightG: 1000, country: 'IT', zoneCode: 'IT_EXTRA_CUSTOMS' }))
      .toMatchObject({ available: false, reason: 'zone_not_deliverable' });
  });

  test('oltre il limite logistico verificato: prezzo teorico + avvertimento', () => {
    expect(price(50000).warnings).toEqual([]);
    expect(price(50001).warnings).toEqual(['logistics_unverified_weight']);
  });
});

test.describe('priceFromTariff — IVA', () => {
  test('IVA già inclusa: nessuna doppia IVA, quota IVA solo informativa', () => {
    const r = price(5000);
    expect(r.totalTtcCents).toBe(840);
    expect(r.vat).toEqual({ includedInTariff: true, rate: 0.22, amountCents: 840 - Math.round(840 / 1.22) });
  });

  test('IVA da applicare una volta sola', () => {
    const ht: TariffSnapshot = { ...CHLOEFOOD_TARIFF, pricesIncludeVat: false, bands: [{ min_g_exclusive: 0, max_g_inclusive: 30000, price_cents: 1000 }] };
    const r = price(2000, null, ht);
    expect(r.configuredTotalCents).toBe(1000);
    expect(r.vat.amountCents).toBe(220);
    expect(r.totalTtcCents).toBe(1220);
    expect(priceFromTariff(ht, { weightG: 2000, country: 'IT', zoneCode: null, vatRate: null }))
      .toMatchObject({ available: false, reason: 'vat_rate_missing' });
  });
});

test.describe('regole commerciali paese', () => {
  const rule = (r: Partial<ShippingCountryRule>): ShippingCountryRule => ({
    countries: ['IT'], free_shipping_above: null, flat_rate_override: null, discount_type: null, discount_value: null, ...r,
  });

  test('nessuna regola attiva: prezzo teorico invariato', () => {
    expect(applyCommercialRulesCents(1640, 12000, null)).toMatchObject({ ruleApplied: false, finalCents: 1640, freeShippingApplied: false });
  });

  test('flat_rate_override ha precedenza, poi sconto', () => {
    const r = applyCommercialRulesCents(1640, 5000, rule({ flat_rate_override: 5, discount_type: 'percentage', discount_value: 10 }));
    expect(r).toMatchObject({ overrideApplied: true, afterOverrideCents: 500, discountCents: 50, finalCents: 450 });
    expect(r.theoreticalCents).toBe(1640);
  });

  test('soglia di gratuità sul subtotale server-side', () => {
    expect(applyCommercialRulesCents(840, 9999, rule({ free_shipping_above: 99.99 }))).toMatchObject({ freeShippingApplied: true, finalCents: 0 });
    expect(applyCommercialRulesCents(840, 9998, rule({ free_shipping_above: 99.99 }))).toMatchObject({ freeShippingApplied: false, finalCents: 840 });
  });

  test('stessa precedenza del checkout live (applyCountryRule)', () => {
    const cases: Array<[number, number, ShippingCountryRule]> = [
      [1640, 3000, rule({ discount_type: 'fixed', discount_value: 2 })],
      [840, 12000, rule({ free_shipping_above: 100, flat_rate_override: 7 })],
      [3240, 1000, rule({ discount_type: 'percentage', discount_value: 33 })],
    ];
    for (const [base, subtotal, r] of cases) {
      const live = applyCountryRule(base / 100, subtotal / 100, r);
      expect(applyCommercialRulesCents(base, subtotal, r).finalCents).toBe(Math.round(live.finalCost * 100));
    }
  });
});

function row(overrides: Partial<ShippingTariffVersionRow> = {}): ShippingTariffVersionRow {
  return {
    id: 'v1', tenant_id: 't1', country: 'IT', currency: 'EUR', version: 1, status: 'shadow', name: 'Grille',
    bands: CHLOEFOOD_TARIFF.bands, zone_surcharges: CHLOEFOOD_TARIFF.zoneSurcharges, non_deliverable_zones: ['IT_EXTRA_CUSTOMS'],
    max_parcel_weight_g: 15000, block_weight_g: 30000, block_price_cents: 1980, logistics_verified_max_weight_g: 50000,
    prices_include_vat: true, source_draft_id: null, notes: null, created_by: null, created_at: '', selected_at: null, retired_at: null, updated_at: '',
    ...overrides,
  };
}

test.describe('validazione delle versioni', () => {
  test('versione ChloeFood valida', () => {
    const parsed = parseTariffVersion(row());
    expect(parsed.ok).toBe(true);
  });

  test('fasce: inizio a 0, contigue, illimitata solo in fondo', () => {
    expect(validateTariffFields(row({ bands: [{ min_g_exclusive: 100, max_g_inclusive: 5000, price_cents: 1 }] }))).toContain('bands_not_starting_at_zero');
    expect(validateTariffFields(row({ bands: [
      { min_g_exclusive: 0, max_g_inclusive: 5000, price_cents: 1 },
      { min_g_exclusive: 6000, max_g_inclusive: 30000, price_cents: 2 },
    ] }))).toContain('bands_not_contiguous');
    expect(validateTariffFields(row({ bands: [
      { min_g_exclusive: 0, max_g_inclusive: null, price_cents: 1 },
      { min_g_exclusive: 5000, max_g_inclusive: 30000, price_cents: 2 },
    ] }))).toContain('band_unbounded_not_last');
    expect(validateTariffFields(row({ bands: [{ min_g_exclusive: 0, max_g_inclusive: 5000, price_cents: -1 }] }))).toContain('band_invalid');
    expect(validateTariffFields(row({ bands: [] }))).toContain('bands_empty');
  });

  test('blocco coperto dalle fasce, completo, maggiorazioni uniche', () => {
    expect(validateTariffFields(row({ block_weight_g: 40000 }))).toContain('bands_do_not_cover_block');
    expect(validateTariffFields(row({ block_price_cents: null }))).toContain('block_incomplete');
    expect(validateTariffFields(row({ zone_surcharges: [
      { zone_code: 'IT_SICILY', amount_cents: 200, mode: 'per_parcel' },
      { zone_code: 'IT_SICILY', amount_cents: 300, mode: 'per_order' },
    ] }))).toContain('zone_surcharge_duplicate');
    expect(parseTariffVersion(row({ max_parcel_weight_g: 0 }))).toMatchObject({ ok: false });
  });
});

test.describe('bozza → versione', () => {
  const draft = {
    id: 'draft-1',
    name: 'Grille ChloeFood 23/09',
    bands: [
      { minKg: 10, maxKg: 15, price: 12.6 },
      { minKg: 0, maxKg: 5, price: 8.4 },
      { minKg: 5, maxKg: 10, price: 10.8 },
      { minKg: 15, maxKg: 20, price: 16.4 },
      { minKg: 20, maxKg: 30, price: 19.8 },
    ],
    zone_surcharges: { IT_SICILY: 2, IT_SARDINIA: 2, IT_CALABRIA: 2 },
    multi_parcel_strategy: { type: 'weight_bands_whole_order' as const, zoneSurchargeMode: 'per_parcel' as const },
  };
  const opts = { country: 'it', pricesIncludeVat: true, maxParcelKg: 15, blockKg: 30, blockPrice: 19.8, nonDeliverableZones: ['IT_EXTRA_CUSTOMS'], logisticsVerifiedMaxKg: 50 };

  test('converte in grammi/centesimi, ordina, conserva la modalità per collo', () => {
    const built = buildVersionFromDraft(draft, opts);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.country).toBe('IT');
    expect(built.payload.bands).toEqual(CHLOEFOOD_TARIFF.bands);
    expect(built.payload.zone_surcharges).toEqual(CHLOEFOOD_TARIFF.zoneSurcharges);
    expect(built.payload).toMatchObject({ max_parcel_weight_g: 15000, block_weight_g: 30000, block_price_cents: 1980, logistics_verified_max_weight_g: 50000, source_draft_id: 'draft-1' });
  });

  test('strategie «1er colis + …» non supportate', () => {
    const built = buildVersionFromDraft({ ...draft, multi_parcel_strategy: { type: 'first_parcel_plus_percentage', percentageDiscount: 50, parcelMaxKg: 15 } }, opts);
    expect(built).toEqual({ ok: false, errors: ['strategy_unsupported'] });
  });

  test('blocco incompleto rifiutato', () => {
    expect(buildVersionFromDraft(draft, { ...opts, blockPrice: null })).toMatchObject({ ok: false, errors: ['block_incomplete'] });
  });
});

test.describe('griglia a 3 fasce con blocchi da 15 kg (FR/BE/DE)', () => {
  const FR: TariffSnapshot = {
    ...CHLOEFOOD_TARIFF,
    id: 'v-fr-1', country: 'FR', zoneSurcharges: [], nonDeliverableZones: [],
    bands: [
      { min_g_exclusive: 0, max_g_inclusive: 5000, price_cents: 1400 },
      { min_g_exclusive: 5000, max_g_inclusive: 10000, price_cents: 1800 },
      { min_g_exclusive: 10000, max_g_inclusive: 15000, price_cents: 2000 },
    ],
    blockWeightG: 15000, blockPriceCents: 2000, logisticsVerifiedMaxWeightG: 15000,
  };
  const fr = (g: number) => {
    const r = priceFromTariff(FR, { weightG: g, country: 'FR', zoneCode: 'FR_MAINLAND' });
    if (!r.available) throw new Error(r.reason);
    return r;
  };

  test('fino a 15 kg la fascia, oltre blocchi da 15 kg + fascia del resto', () => {
    expect(fr(15000).totalTtcCents).toBe(2000);
    expect(fr(15001)).toMatchObject({ blocks: 1, remainderWeightG: 1, totalTtcCents: 2000 + 1400 });
    expect(fr(20000).totalTtcCents).toBe(3400);
    expect(fr(30000)).toMatchObject({ blocks: 2, band: null, totalTtcCents: 4000 });
    expect(fr(40000).totalTtcCents).toBe(4000 + 1800);
    expect(fr(20000).warnings).toEqual(['logistics_unverified_weight']);
  });
});
