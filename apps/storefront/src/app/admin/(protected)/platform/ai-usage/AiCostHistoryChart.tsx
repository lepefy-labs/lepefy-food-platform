'use client';

export interface AiCostHistoryPoint {
  key: string;
  label: string;
  fullLabel: string;
  cost: number;
  calls: number;
}

interface AiCostHistoryChartProps {
  points: AiCostHistoryPoint[];
  currentCost: number;
  previousCost: number;
  totalCost12Months: number;
}

const POINT_COLORS = ['#7C3AED', '#8B5CF6', '#A855F7', '#C026D3', '#DB2777', '#E11D48', '#F97316', '#F59E0B', '#84CC16', '#10B981', '#06B6D4', '#3B82F6'];

function formatUsd(amount: number): string {
  if (amount === 0) return '$0.0000';
  if (amount < 0.0001) return '<$0.0001';
  return `$${amount.toFixed(4)}`;
}

function trendLabel(current: number, previous: number): { label: string; tone: string } {
  if (previous <= 0 && current <= 0) {
    return { label: 'Stable vs mois précédent', tone: 'text-slate-600 dark:text-slate-300' };
  }
  if (previous <= 0) {
    return { label: 'Nouveau coût ce mois', tone: 'text-fuchsia-700 dark:text-fuchsia-300' };
  }

  const variation = ((current - previous) / previous) * 100;
  if (Math.abs(variation) < 0.05) {
    return { label: 'Stable vs mois précédent', tone: 'text-slate-600 dark:text-slate-300' };
  }

  return {
    label: `${variation > 0 ? '+' : ''}${variation.toFixed(1)} % vs mois précédent`,
    tone: variation > 0 ? 'text-orange-700 dark:text-orange-300' : 'text-emerald-700 dark:text-emerald-300',
  };
}

export default function AiCostHistoryChart({ points, currentCost, previousCost, totalCost12Months }: AiCostHistoryChartProps) {
  const width = 820;
  const height = 280;
  const left = 28;
  const right = 26;
  const top = 26;
  const bottom = 54;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxCost = Math.max(...points.map((point) => point.cost), 0.0001);
  const xFor = (index: number) => left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yFor = (cost: number) => top + plotHeight - (cost / maxCost) * plotHeight;
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xFor(index).toFixed(2)} ${yFor(point.cost).toFixed(2)}`).join(' ');
  const areaPath = points.length > 0
    ? `${linePath} L ${xFor(points.length - 1).toFixed(2)} ${(top + plotHeight).toFixed(2)} L ${xFor(0).toFixed(2)} ${(top + plotHeight).toFixed(2)} Z`
    : '';
  const trend = trendLabel(currentCost, previousCost);

  return (
    <section className="overflow-hidden rounded-3xl border border-violet-200/80 bg-gradient-to-br from-violet-50 via-white to-orange-50 shadow-sm dark:border-violet-900/70 dark:from-violet-950/30 dark:via-gray-900 dark:to-orange-950/20">
      <div className="flex flex-col gap-3 border-b border-violet-100/80 px-5 py-4 dark:border-violet-900/50 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-500 to-orange-400 shadow-[0_0_14px_rgba(217,70,239,0.65)]" />
            <h2 className="text-sm font-bold text-gray-950 dark:text-white">Évolution des coûts IA</h2>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Coût provider estimé · 12 derniers mois</p>
        </div>
        <span className="w-fit rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-600 to-orange-500 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white shadow-sm">
          Historique 12 mois
        </span>
      </div>

      <div className="p-4 sm:p-5">
        <div className="relative overflow-hidden rounded-2xl border border-white/80 bg-slate-950 px-2 pt-3 shadow-xl shadow-violet-200/40 dark:border-white/10 dark:shadow-none">
          <div className="pointer-events-none absolute -left-10 -top-14 h-36 w-36 rounded-full bg-violet-600/35 blur-3xl" />
          <div className="pointer-events-none absolute right-10 top-0 h-28 w-28 rounded-full bg-fuchsia-500/25 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-12 right-0 h-36 w-36 rounded-full bg-orange-500/25 blur-3xl" />

          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="relative z-10 h-auto w-full min-w-[640px]"
            role="img"
            aria-label="Évolution mensuelle des coûts IA estimés sur les douze derniers mois"
          >
            <defs>
              <linearGradient id="aiCostLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#8B5CF6" />
                <stop offset="35%" stopColor="#D946EF" />
                <stop offset="68%" stopColor="#FB7185" />
                <stop offset="100%" stopColor="#F59E0B" />
              </linearGradient>
              <linearGradient id="aiCostArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#C026D3" stopOpacity="0.50" />
                <stop offset="55%" stopColor="#7C3AED" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#0F172A" stopOpacity="0" />
              </linearGradient>
              <filter id="aiCostGlow" x="-20%" y="-30%" width="140%" height="160%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = top + plotHeight * ratio;
              const value = maxCost * (1 - ratio);
              return (
                <g key={ratio}>
                  <line x1={left} x2={width - right} y1={y} y2={y} stroke="#334155" strokeWidth="1" strokeDasharray="5 8" />
                  <text x={left} y={Math.max(14, y - 7)} fill="#94A3B8" fontSize="11">{formatUsd(value)}</text>
                </g>
              );
            })}

            {areaPath && <path d={areaPath} fill="url(#aiCostArea)" />}
            {linePath && (
              <>
                <path d={linePath} fill="none" stroke="#D946EF" strokeOpacity="0.28" strokeWidth="12" filter="url(#aiCostGlow)" />
                <path d={linePath} fill="none" stroke="url(#aiCostLine)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
              </>
            )}

            {points.map((point, index) => {
              const x = xFor(index);
              const y = yFor(point.cost);
              const color = POINT_COLORS[index % POINT_COLORS.length];
              return (
                <g key={point.key}>
                  <circle cx={x} cy={y} r="9" fill={color} fillOpacity="0.18" />
                  <circle cx={x} cy={y} r="5" fill={color} stroke="#F8FAFC" strokeWidth="2.5">
                    <title>{`${point.fullLabel}: ${formatUsd(point.cost)} · ${point.calls} appels`}</title>
                  </circle>
                  <text x={x} y={height - 25} textAnchor="middle" fill="#CBD5E1" fontSize="11" fontWeight="600">
                    {point.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-100 to-violet-50 p-4 dark:border-violet-900 dark:from-violet-950/50 dark:to-violet-950/20">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300">Ce mois</p>
            <p className="mt-2 text-2xl font-black text-violet-950 dark:text-violet-100">{formatUsd(currentCost)}</p>
          </div>
          <div className="rounded-2xl border border-fuchsia-200 bg-gradient-to-br from-fuchsia-100 to-pink-50 p-4 dark:border-fuchsia-900 dark:from-fuchsia-950/50 dark:to-pink-950/20">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-fuchsia-700 dark:text-fuchsia-300">Tendance</p>
            <p className={`mt-2 text-sm font-extrabold ${trend.tone}`}>{trend.label}</p>
          </div>
          <div className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-100 to-amber-50 p-4 dark:border-orange-900 dark:from-orange-950/50 dark:to-amber-950/20">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-orange-700 dark:text-orange-300">Cumul 12 mois</p>
            <p className="mt-2 text-2xl font-black text-orange-950 dark:text-orange-100">{formatUsd(totalCost12Months)}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
