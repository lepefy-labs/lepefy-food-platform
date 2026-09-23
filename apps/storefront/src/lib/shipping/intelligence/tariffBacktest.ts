import type { ShippingMultiParcelStrategy, ShippingQuoteObservationRow, ShippingTariffBand } from '@lepefy/types';
import { latestValidPerScenario } from './operationalObservation';

export interface BacktestRow {
  /** Devis Packlink TTC. */
  providerCost: number;
  weightKg: number;
  zoneCode: string | null;
  numParcels: number;
  /** Frais d'emballage facturés aujourd'hui (packaging_surcharges), TTC. */
  packagingCost?: number;
}

export type ScenarioBacktestObservation = Pick<ShippingQuoteObservationRow,
  | 'id' | 'request_hash' | 'observed_at' | 'eligible' | 'total_provider_cost' | 'total_weight_g'
  | 'destination_zone_code' | 'destination_country' | 'destination_postal_code' | 'num_parcels'>
  & Partial<Pick<ShippingQuoteObservationRow, 'tax_price'>>;

/**
 * Base de comparaison : les brouillons sont des prix CLIENT TTC. Packlink
 * renvoie tax_price = 0 (devis HT) et le checkout ajoute la TVA du pays
 * (shipping_vat_rates) : le coût comparé doit donc être le devis TTC, sinon la
 * marge est surestimée d'environ le taux de TVA.
 */
export function providerCostTtc(costExclOrInclTax: number, taxPrice: number | null | undefined, vatRate: number): number {
  if (taxPrice != null && Number(taxPrice) > 0) return parseFloat(Number(costExclOrInclTax).toFixed(2));
  return parseFloat((Number(costExclOrInclTax) * (1 + vatRate)).toFixed(2));
}

/**
 * Commandes réelles : packlinkCost est HT, vatAmount la TVA appliquée au
 * checkout. Filtrées sur le pays du brouillon (un forfait Italie ne se
 * compare pas à une commande belge).
 */
export function orderBacktestRows(
  orders: Array<{ shipping_details: Record<string, unknown> | null; shipping_address?: Record<string, unknown> | null }>,
  country: string,
): BacktestRow[] {
  return orders
    .filter((o) => String(o.shipping_address?.country ?? '').toUpperCase() === country.toUpperCase())
    .map((o) => o.shipping_details)
    .filter((d): d is Record<string, unknown> => d !== null && typeof d.packlinkCost === 'number' && typeof d.totalWeightG === 'number')
    .map((d) => ({
      providerCost: parseFloat(((d.packlinkCost as number) + (typeof d.vatAmount === 'number' ? d.vatAmount : 0)).toFixed(2)),
      packagingCost: typeof d.packagingSurchargeTotal === 'number' ? d.packagingSurchargeTotal : 0,
      weightKg: (d.totalWeightG as number) / 1000,
      zoneCode: null,
      numParcels: typeof d.numParcels === 'number' ? d.numParcels : 1,
    }));
}

export interface ScenarioSampleStats {
  /** Lignes d'offres provider lues (alternatives comprises). */
  offersRead: number;
  /** Exécutions de devis distinctes (un appel provider = une exécution). */
  executions: number;
  /** Scénarios distincts mesurés = taille réelle de l'échantillon. */
  scenarios: number;
  /** Offres alternatives écartées (non comptées comme échantillons). */
  alternativeOffersExcluded: number;
  /** Exécutions plus anciennes d'un même scénario écartées. */
  olderExecutionsExcluded: number;
  postalCodes: number;
  zones: number;
  countries: number;
  /** Part du CAP le plus représenté (0–1) : concentration géographique. */
  topPostalCodeShare: number;
}

/**
 * Transforme des lignes d'offres (une par service Packlink) en échantillon
 * statistique : UNE observation opérationnelle (service éligible au coût total
 * le plus bas) par exécution, puis UNE exécution — la plus récente valide —
 * par scénario (request_hash). Les offres alternatives d'un même devis ne sont
 * jamais des tirages indépendants.
 */
export function buildScenarioBacktestSample(
  rows: ScenarioBacktestObservation[],
  /** Zone recalculée depuis le CAP (zones tenant) ; à défaut, la zone stockée. */
  resolveZone?: (country: string, postalCode: string) => string | null,
  /** Taux de TVA du pays de destination, ajouté quand Packlink ne renvoie pas de taxe. */
  vatRateFor?: (country: string) => number,
): { rows: BacktestRow[]; stats: ScenarioSampleStats } {
  const perScenario = latestValidPerScenario(rows);
  const executions = new Set(rows.map((r) => `${r.request_hash}@${new Date(r.observed_at).toISOString()}`)).size;
  const postal = new Map<string, number>();
  const zones = new Set<string>();
  const countries = new Set<string>();
  let executionsUsedTotal = 0;

  const backtestRows: BacktestRow[] = perScenario.map(({ chosen, executionsForScenario }) => {
    executionsUsedTotal += executionsForScenario;
    const postalKey = `${chosen.destination_country}|${chosen.destination_postal_code}`;
    postal.set(postalKey, (postal.get(postalKey) ?? 0) + 1);
    const zoneCode = resolveZone
      ? resolveZone(chosen.destination_country, chosen.destination_postal_code)
      : chosen.destination_zone_code;
    if (zoneCode) zones.add(zoneCode);
    countries.add(chosen.destination_country);
    return {
      providerCost: vatRateFor
        ? providerCostTtc(Number(chosen.total_provider_cost), chosen.tax_price, vatRateFor(chosen.destination_country))
        : Number(chosen.total_provider_cost),
      weightKg: chosen.total_weight_g / 1000,
      zoneCode,
      numParcels: chosen.num_parcels,
    };
  });

  const scenarios = backtestRows.length;
  const topPostal = Math.max(0, ...Array.from(postal.values()));
  return {
    rows: backtestRows,
    stats: {
      offersRead: rows.length,
      executions,
      scenarios,
      alternativeOffersExcluded: rows.length - executions,
      olderExecutionsExcluded: Math.max(0, executionsUsedTotal - scenarios),
      postalCodes: postal.size,
      zones: zones.size,
      countries: countries.size,
      topPostalCodeShare: scenarios > 0 ? parseFloat((topPostal / scenarios).toFixed(3)) : 0,
    },
  };
}

export type SampleReliability = 'insufficient' | 'limited' | 'indicative';

export const MIN_SCENARIOS_FOR_INDICATIVE = 30;
export const MIN_POSTAL_CODES_FOR_INDICATIVE = 10;
/** Couverture par zone : quelques CAP témoins par zone suffisent (prix identiques dans une zone). */
export const MIN_ZONES_FOR_INDICATIVE = 3;

/**
 * Fiabilité volontairement prudente d'un échantillon SYNTHÉTIQUE : jamais
 * « élevée » (grille uniforme, pas la fréquence réelle des commandes).
 *  - insufficient : < 30 scénarios distincts ;
 *  - limited      : couverture géographique étroite (< 3 zones ET < 10 CAP,
 *                   ou un CAP > 50 % de l'échantillon) ;
 *  - indicative   : sinon.
 */
export function assessScenarioReliability(stats: Pick<ScenarioSampleStats, 'scenarios' | 'postalCodes' | 'topPostalCodeShare'> & { zones?: number }): SampleReliability {
  if (stats.scenarios < MIN_SCENARIOS_FOR_INDICATIVE) return 'insufficient';
  if (stats.topPostalCodeShare > 0.5) return 'limited';
  if (stats.postalCodes < MIN_POSTAL_CODES_FOR_INDICATIVE && (stats.zones ?? 0) < MIN_ZONES_FOR_INDICATIVE) return 'limited';
  return 'indicative';
}

export interface BacktestMetrics {
  sampleSize: number;
  avgProviderCost: number | null;
  medianProviderCost: number | null;
  p90ProviderCost: number | null;
  p95ProviderCost: number | null;
  avgMargin: number | null;
  negativeMarginPct: number | null;
  /** Perte la plus forte (≤ 0) ; 0 si aucun cas à perte. */
  maxLoss: number | null;
  /** Marge la plus faible observée (peut être positive). */
  minMargin: number | null;
  aggregateMargin: number | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

/** Découpage « rempli » : colis de parcelMaxKg, le reste dans le dernier (20 kg / 15 → 15 + 5). */
export function splitParcelsFilled(weightKg: number, parcelMaxKg: number): number[] {
  const parcels: number[] = [];
  let remainingG = Math.round(weightKg * 1000);
  const maxG = Math.round(parcelMaxKg * 1000);
  if (maxG <= 0) return [weightKg];
  while (remainingG > 0) {
    const g = Math.min(maxG, remainingG);
    parcels.push(g / 1000);
    remainingG -= g;
  }
  return parcels.length > 0 ? parcels : [weightKg];
}

function bandPrice(sortedBands: ShippingTariffBand[], weightKg: number): number | null {
  const band = sortedBands.find((b) => weightKg >= b.minKg && (b.maxKg === null || weightKg <= b.maxKg));
  return band ? band.price : null;
}

/**
 * Tarif client pour un poids/zone/nombre de colis donné, selon un brouillon
 * de tarif. Bandes triées par minKg ; maxKg = null → pas de plafond.
 * Stratégies « 1er colis + … » avec parcelMaxKg : calcul colis par colis
 * (colis remplis jusqu'à parcelMaxKg, le 1er au prix de sa bande). La
 * surcharge de zone s'applique une fois par commande.
 * Ne modifie jamais rien en checkout — appelé uniquement par le laboratoire.
 */
export function applyTariffDraft(
  bands: ShippingTariffBand[],
  zoneSurcharges: Record<string, number>,
  multiParcelStrategy: ShippingMultiParcelStrategy | null,
  input: { weightKg: number; zoneCode: string | null; numParcels: number },
): number | null {
  const sorted = [...bands].sort((a, b) => a.minKg - b.minKg);
  const surcharge = input.zoneCode ? zoneSurcharges[input.zoneCode] ?? 0 : 0;
  const strategy = multiParcelStrategy;

  if (strategy && (strategy.type === 'first_parcel_plus_percentage' || strategy.type === 'first_parcel_plus_discounted') && strategy.parcelMaxKg) {
    const parcels = splitParcelsFilled(input.weightKg, strategy.parcelMaxKg);
    const first = bandPrice(sorted, parcels[0]!);
    if (first === null) return null;
    let price = first;
    for (const parcel of parcels.slice(1)) {
      if (strategy.type === 'first_parcel_plus_discounted') {
        price += strategy.discountedParcelRate ?? 0;
      } else {
        const parcelPrice = bandPrice(sorted, parcel);
        if (parcelPrice === null) return null;
        price += parcelPrice * (1 - Math.min(Math.max(strategy.percentageDiscount ?? 0, 0), 100) / 100);
      }
    }
    return parseFloat((price + surcharge).toFixed(2));
  }

  const whole = bandPrice(sorted, input.weightKg);
  if (whole === null) return null;
  let price = whole + surcharge;

  if (input.numParcels > 1 && strategy) {
    if (strategy.type === 'first_parcel_plus_discounted') {
      price += (input.numParcels - 1) * (strategy.discountedParcelRate ?? 0);
    } else if (strategy.type === 'flat_multi_parcel_rate' && strategy.flatMultiParcelRate != null) {
      price = strategy.flatMultiParcelRate;
    }
    // 'weight_bands_whole_order' : le tarif de bande s'applique déjà au poids total, rien à ajouter.
  }

  return parseFloat(price.toFixed(2));
}

/** Validation serveur d'une stratégie multi-colis (null = bande sur le poids total). */
export function validateMultiParcelStrategy(raw: unknown): ShippingMultiParcelStrategy | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return 'invalid';
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
  const parcelMaxKg = num(r.parcelMaxKg);
  if (parcelMaxKg !== undefined && (!Number.isFinite(parcelMaxKg) || parcelMaxKg <= 0 || parcelMaxKg > 100)) return 'invalid';
  switch (r.type) {
    case 'weight_bands_whole_order':
      return { type: 'weight_bands_whole_order' };
    case 'first_parcel_plus_percentage': {
      const pct = num(r.percentageDiscount);
      if (pct === undefined || !Number.isFinite(pct) || pct < 0 || pct > 100 || parcelMaxKg === undefined) return 'invalid';
      return { type: 'first_parcel_plus_percentage', percentageDiscount: pct, parcelMaxKg };
    }
    case 'first_parcel_plus_discounted': {
      const rate = num(r.discountedParcelRate);
      if (rate === undefined || !Number.isFinite(rate) || rate < 0) return 'invalid';
      return { type: 'first_parcel_plus_discounted', discountedParcelRate: rate, ...(parcelMaxKg !== undefined ? { parcelMaxKg } : {}) };
    }
    case 'flat_multi_parcel_rate': {
      const flat = num(r.flatMultiParcelRate);
      if (flat === undefined || !Number.isFinite(flat) || flat < 0) return 'invalid';
      return { type: 'flat_multi_parcel_rate', flatMultiParcelRate: flat };
    }
    default:
      return 'invalid';
  }
}

/** Coût réel complet = devis Packlink TTC + frais d'emballage (ce que le forfait remplace). */
export function withPackagingCost(rows: BacktestRow[]): BacktestRow[] {
  return rows.map((r) => ({ ...r, providerCost: parseFloat((r.providerCost + (r.packagingCost ?? 0)).toFixed(2)) }));
}

/** Frais d'emballage d'une commande selon packaging_surcharges (par colis ou par commande). */
export function packagingCostFor(numParcels: number, surcharge: { surcharge_amount: number; surcharge_mode: string } | null): number {
  if (!surcharge) return 0;
  const amount = Number(surcharge.surcharge_amount) || 0;
  return parseFloat((surcharge.surcharge_mode === 'per_parcel' ? amount * numParcels : amount).toFixed(2));
}

export interface CostComparisonCell {
  /** Montant de surcharge de zone du brouillon (0 = zones standard). */
  zoneSurcharge: number;
  zones: string[];
  scenarios: number;
  packlinkMedian: number;
  packlinkMax: number;
  packaging: number;
  /** Coût réel médian (cas typique) et le plus élevé (cas le plus défavorable). */
  realCostMedian: number;
  realCostMax: number;
  forfait: number | null;
  /** Forfait − coût réel médian (cas typique). */
  typicalGap: number | null;
  /** Forfait − coût réel le plus élevé du groupe (négatif = perte). */
  worstGap: number | null;
}

export interface CostComparisonRow {
  weightKg: number;
  numParcels: number;
  cells: CostComparisonCell[];
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Tableau « coûts réels vs forfait » : pour chaque poids mesuré et chaque
 * groupe de zones de même surcharge, devis Packlink TTC (médiane, max),
 * emballage, coût réel max, prix forfait et écart le plus défavorable.
 */
export function buildCostComparison(
  rows: BacktestRow[],
  bands: ShippingTariffBand[],
  zoneSurcharges: Record<string, number>,
  multiParcelStrategy: ShippingMultiParcelStrategy | null,
): CostComparisonRow[] {
  const byWeight = new Map<number, BacktestRow[]>();
  for (const row of rows) byWeight.set(row.weightKg, [...(byWeight.get(row.weightKg) ?? []), row]);
  return Array.from(byWeight.entries())
    .sort(([a], [b]) => a - b)
    .map(([weightKg, list]) => {
      const groups = new Map<number, BacktestRow[]>();
      for (const row of list) {
        const surcharge = row.zoneCode ? zoneSurcharges[row.zoneCode] ?? 0 : 0;
        groups.set(surcharge, [...(groups.get(surcharge) ?? []), row]);
      }
      const cells: CostComparisonCell[] = Array.from(groups.entries())
        .sort(([a], [b]) => a - b)
        .map(([zoneSurcharge, groupRows]) => {
          const packlink = groupRows.map((r) => r.providerCost);
          const realCosts = groupRows.map((r) => r.providerCost + (r.packagingCost ?? 0));
          const realCostMax = Math.max(...realCosts);
          const realCostMedian = medianOf(realCosts);
          const worst = groupRows[realCosts.indexOf(realCostMax)]!;
          const forfait = applyTariffDraft(bands, zoneSurcharges, multiParcelStrategy, worst);
          return {
            zoneSurcharge,
            zones: Array.from(new Set(groupRows.map((r) => r.zoneCode ?? '—'))).sort(),
            scenarios: groupRows.length,
            packlinkMedian: parseFloat(medianOf(packlink).toFixed(2)),
            packlinkMax: parseFloat(Math.max(...packlink).toFixed(2)),
            packaging: parseFloat((worst.packagingCost ?? 0).toFixed(2)),
            realCostMedian: parseFloat(realCostMedian.toFixed(2)),
            realCostMax: parseFloat(realCostMax.toFixed(2)),
            forfait,
            typicalGap: forfait === null ? null : parseFloat((forfait - realCostMedian).toFixed(2)),
            worstGap: forfait === null ? null : parseFloat((forfait - realCostMax).toFixed(2)),
          };
        });
      return { weightKg, numParcels: Math.max(...list.map((r) => r.numParcels)), cells };
    });
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
      p95ProviderCost: null, avgMargin: null, negativeMarginPct: null, maxLoss: null, minMargin: null, aggregateMargin: null,
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
    maxLoss: parseFloat(Math.min(0, ...margins).toFixed(2)),
    minMargin: parseFloat(Math.min(...margins).toFixed(2)),
    aggregateMargin: parseFloat(margins.reduce((s, m) => s + m, 0).toFixed(2)),
  };
}
