/**
 * Chart colours = admin data-viz tokens (--admin-chart-*, lib/admin/tokens.ts),
 * so every chart switches light/dark with the rest of the admin. Categorical
 * slots are assigned in this fixed order and follow the entity, never its rank.
 * Text never wears these colours (text tokens only).
 */
export const CHART_SERIES = ['var(--admin-chart-1)', 'var(--admin-chart-2)', 'var(--admin-chart-3)'] as const;
export const CHART_SEQUENTIAL = ['var(--admin-surface-subtle)', 'var(--admin-chart-seq-1)', 'var(--admin-chart-seq-2)', 'var(--admin-chart-seq-3)', 'var(--admin-chart-seq-4)'] as const;
export const CHART_MUTED = 'var(--admin-chart-muted)';
export const CHART_GRID = 'var(--admin-chart-grid)';
/** The headline series of a page (one per page): the Lepefy brand colour. */
export const CHART_ACCENT = 'var(--admin-primary)';

export type ChartValueFormat = 'money' | 'number';

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let value = formatters.get(key);
  if (!value) { value = new Intl.NumberFormat('fr-FR', options); formatters.set(key, value); }
  return value;
}

/** Full value (tooltips, tables): « 1 336,40 € », « 21 ». */
export function formatChartValue(value: number | null | undefined, format: ChartValueFormat, currency = 'EUR'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return format === 'money'
    ? formatter(`m-${currency}`, { style: 'currency', currency }).format(value)
    : formatter('n', { maximumFractionDigits: 1 }).format(value);
}

/** Axis tick: round, compact from 10 000 (« 1 500 € », « 12 k€ »). */
export function formatAxisValue(value: number, format: ChartValueFormat, currency = 'EUR'): string {
  if (format === 'money') {
    return Math.abs(value) >= 10_000
      ? formatter(`mc-${currency}`, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value)
      : formatter(`m0-${currency}`, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  }
  return Math.abs(value) >= 10_000
    ? formatter('nc', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    : formatter('n0', { maximumFractionDigits: 1 }).format(value);
}
