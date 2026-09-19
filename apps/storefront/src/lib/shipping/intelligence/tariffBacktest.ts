import type { ShippingMultiParcelStrategy, ShippingTariffBand } from '@lepefy/types';

export interface BacktestRow {
  providerCost: number;
  weightKg: number;
  zoneCode: string | null;
  numParcels: number;
}

export interface BacktestMetrics {
  sampleSize: number;
  avgProviderCost: number | null;
  medianProviderCost: number | null;
  p90ProviderCost: number | null;
  p95ProviderCost: number | null;
  avgMargin: number | null;
  negativeMarginPct: number | null;
  maxLoss: number | null;
  aggregateMargin: number | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

/**
 * Tarif client pour un poids/zone/nombre de colis donné, selon un brouillon
 * de tarif. Bandes triées par minKg ; maxKg = null → pas de plafond.
 * Ne modifie jamais rien en checkout — appelé uniquement par le laboratoire.
 */
export function applyTariffDraft(
  bands: ShippingTariffBand[],
  zoneSurcharges: Record<string, number>,
  multiParcelStrategy: ShippingMultiParcelStrategy | null,
  input: { weightKg: number; zoneCode: string | null; numParcels: number },
): number | null {
  const sorted = [...bands].sort((a, b) => a.minKg - b.minKg);
  const band = sorted.find((b) => input.weightKg >= b.minKg && (b.maxKg === null || input.weightKg <= b.maxKg));
  if (!band) return null;

  let price = band.price;
  if (input.zoneCode && zoneSurcharges[input.zoneCode]) {
    price += zoneSurcharges[input.zoneCode]!;
  }

  if (input.numParcels > 1 && multiParcelStrategy) {
    if (multiParcelStrategy.type === 'first_parcel_plus_discounted') {
      price += (input.numParcels - 1) * (multiParcelStrategy.discountedParcelRate ?? 0);
    } else if (multiParcelStrategy.type === 'flat_multi_parcel_rate' && multiParcelStrategy.flatMultiParcelRate != null) {
      price = multiParcelStrategy.flatMultiParcelRate;
    }
    // 'weight_bands_whole_order' : le tarif de bande s'applique déjà au poids total, rien à ajouter.
  }

  return parseFloat(price.toFixed(2));
}

export function backtestTariff(
  bands: ShippingTariffBand[],
  zoneSurcharges: Record<string, number>,
  multiParcelStrategy: ShippingMultiParcelStrategy | null,
  rows: BacktestRow[],
): BacktestMetrics {
  const evaluated = rows
    .map((r) => {
      const customerTariff = applyTariffDraft(bands, zoneSurcharges, multiParcelStrategy, r);
      if (customerTariff === null) return null;
      return { providerCost: r.providerCost, margin: customerTariff - r.providerCost };
    })
    .filter((v): v is { providerCost: number; margin: number } => v !== null);

  const sampleSize = evaluated.length;
  if (sampleSize === 0) {
    return {
      sampleSize: 0, avgProviderCost: null, medianProviderCost: null, p90ProviderCost: null,
      p95ProviderCost: null, avgMargin: null, negativeMarginPct: null, maxLoss: null, aggregateMargin: null,
    };
  }

  const costsSorted = evaluated.map((e) => e.providerCost).sort((a, b) => a - b);
  const margins = evaluated.map((e) => e.margin);
  const negativeCount = margins.filter((m) => m < 0).length;

  return {
    sampleSize,
    avgProviderCost: parseFloat((costsSorted.reduce((s, c) => s + c, 0) / sampleSize).toFixed(2)),
    medianProviderCost: parseFloat(percentile(costsSorted, 50).toFixed(2)),
    p90ProviderCost: parseFloat(percentile(costsSorted, 90).toFixed(2)),
    p95ProviderCost: parseFloat(percentile(costsSorted, 95).toFixed(2)),
    avgMargin: parseFloat((margins.reduce((s, m) => s + m, 0) / sampleSize).toFixed(2)),
    negativeMarginPct: parseFloat(((negativeCount / sampleSize) * 100).toFixed(1)),
    maxLoss: parseFloat(Math.min(...margins).toFixed(2)),
    aggregateMargin: parseFloat(margins.reduce((s, m) => s + m, 0).toFixed(2)),
  };
}
