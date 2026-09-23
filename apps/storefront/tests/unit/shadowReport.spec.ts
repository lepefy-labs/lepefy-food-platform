import { expect, test } from '@playwright/test';
import { reportPeriod, summarizeShadowOrders, type ShadowReportOrder } from '../../src/lib/shipping/tariff/shadowReport';
import type { ShadowTariffRecord } from '../../src/lib/shipping/tariff/shadowTariff';

function record(overrides: Partial<ShadowTariffRecord> & { shadow?: number; charged?: number; margin?: number | null; zone?: string | null } = {}): ShadowTariffRecord {
  const { shadow = 840, charged = 889, margin = 251, zone = 'IT_LOMBARDIA', ...rest } = overrides;
  return {
    schema: 1,
    status: 'complete',
    reasons: [],
    computedAt: '2026-09-24T10:00:00.000Z',
    tariff: { versionId: 'ver-2', version: 2, country: 'IT', currency: 'EUR', pricesIncludeVat: true },
    destination: { country: 'IT', postalCode: '20121', zoneCode: zone },
    weight: { netG: 4500, missingWeightProductIds: [], tareG: null },
    pricing: {
      blocks: 0, blockWeightG: null, blockPriceCents: null, remainderWeightG: 4500,
      band: { minGExclusive: 0, maxGInclusive: 5000, priceCents: 840 }, parcelsG: [4500], numParcels: 1,
      zoneSurcharge: null, baseCents: 840, vatRate: 0.22, vatIncludedInTariff: true, vatAmountCents: 151, theoreticalTtcCents: 840,
    },
    commercial: null,
    shadowTtcCents: shadow,
    chargedCents: charged,
    provider: { verification: margin === null ? 'unverified' : 'matches_signed_total', quoteTtcCents: margin === null ? null : shadow - margin, packagingSurchargeChargedCents: 300 },
    packagingCostCents: null,
    comparison: { shadowMinusChargedCents: shadow - charged, expectedMarginBeforePackagingCents: margin, expectedMarginCents: null },
    warnings: [],
    ...rest,
  };
}

let n = 0;
function order(details: Record<string, unknown> | null, fulfillment: 'delivery' | 'pickup' = 'delivery', isTest = false): ShadowReportOrder {
  n += 1;
  return { id: `order-${String(n).padStart(4, '0')}`, created_at: `2026-09-${String(10 + (n % 10)).padStart(2, '0')}T12:00:00Z`, fulfillment_type: fulfillment, is_test: isTest, shipping_details: details };
}

test.describe('summarizeShadowOrders', () => {
  test('sépare retraits, commandes sans calcul, complètes et exclues', () => {
    const report = summarizeShadowOrders([
      order({ shadow_tariff: record() }),
      order({ shadow_tariff: record({ shadow: 1080, charged: 912, margin: -40 }) }),
      order({ shadow_tariff: record({ status: 'incomplete', reasons: ['missing_product_weight'], shadow: 0, margin: null, shadowTtcCents: null, weight: { netG: null, missingWeightProductIds: ['a', 'b'], tareG: null } }) }),
      order({ shadow_tariff: record({ status: 'error', reasons: ['timeout'], shadowTtcCents: null }) }),
      order({ packlinkCost: 4.83 }),
      order(null, 'pickup'),
      order({ shadow_tariff: record() }, 'delivery', true),
      order({ shadow_tariff: { status: 'complete', shadowTtcCents: 1 } }),
    ]);
    expect(report).toMatchObject({ deliveryOrders: 6, pickupOrders: 1, withoutShadow: 2, recorded: 4 });
    expect(report.byStatus).toEqual({ complete: 2, incomplete: 1, unavailable: 0, error: 1 });
    expect(report.reasons).toEqual(expect.arrayContaining([{ reason: 'missing_product_weight', count: 1 }, { reason: 'timeout', count: 1 }]));
    expect(report.gap).toMatchObject({ count: 2, avgCents: Math.round(((840 - 889) + (1080 - 912)) / 2), minCents: -49, maxCents: 168 });
    expect(report.marginBeforePackaging).toEqual({ count: 2, avgCents: Math.round((251 - 40) / 2), negative: 1 });
    expect(report.negativeMarginOrders.map((o) => o.marginBeforePackagingCents)).toEqual([-40]);
    expect(report.excludedOrders.find((o) => o.status === 'incomplete')?.missingWeightProducts).toBe(2);
    expect(report.reliability).toBe('insufficient');
  });

  test('marges non vérifiées exclues de la moyenne, distribution par tranche et zone', () => {
    const report = summarizeShadowOrders([
      order({ shadow_tariff: record({ margin: null }) }),
      order({ shadow_tariff: record({ zone: 'IT_SICILY', shadow: 1040 }) }),
    ]);
    expect(report.providerQuote.verified).toBe(1);
    expect(report.marginBeforePackaging.count).toBe(1);
    expect(report.byBand).toEqual([{ key: '0–5 kg', label: '0–5 kg', count: 2, avgShadowCents: 940, avgChargedCents: 889 }]);
    expect(report.byZone.map((z) => z.key).sort()).toEqual(['IT_LOMBARDIA', 'IT_SICILY']);
  });

  test('filtre par version', () => {
    const other = record({ tariff: { versionId: 'ver-1', version: 1, country: 'IT', currency: 'EUR', pricesIncludeVat: true } });
    const report = summarizeShadowOrders([order({ shadow_tariff: record() }), order({ shadow_tariff: other })], { versionId: 'ver-1' });
    expect(report.recorded).toBe(1);
    expect(report.versions).toEqual([{ versionId: 'ver-1', version: 1, country: 'IT', count: 1 }]);
  });

  test('fiabilité prudente selon le nombre de simulations complètes', () => {
    const many = (k: number) => Array.from({ length: k }, () => order({ shadow_tariff: record() }));
    expect(summarizeShadowOrders(many(29)).reliability).toBe('insufficient');
    expect(summarizeShadowOrders(many(30)).reliability).toBe('limited');
    expect(summarizeShadowOrders(many(100)).reliability).toBe('indicative');
  });
});

test.describe('reportPeriod', () => {
  test('30 derniers jours par défaut, dates invalides refusées', () => {
    expect(reportPeriod(null, null, new Date('2026-09-24T08:00:00Z'))).toEqual({ fromIso: '2026-08-26T00:00:00.000Z', toIso: '2026-09-24T23:59:59.999Z' });
    expect(reportPeriod('2026-09-30', '2026-09-01')).toBeNull();
    expect(reportPeriod('2026-09-01', '2026-09-02')).toEqual({ fromIso: '2026-09-01T00:00:00.000Z', toIso: '2026-09-02T23:59:59.999Z' });
  });
});
