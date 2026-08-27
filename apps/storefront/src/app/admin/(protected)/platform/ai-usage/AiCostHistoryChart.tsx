'use client';

import { useMemo, useState } from 'react';

export interface AiCostDetailRow {
  feature: string;
  provider: string;
  endpoint: string;
  calls: number;
  cost: number;
}

export interface AiCostHistoryPoint {
  key: string;
  label: string;
  fullLabel: string;
  cost: number;
  calls: number;
  details: AiCostDetailRow[];
}

interface AiCostHistoryChartProps {
  points: AiCostHistoryPoint[];
}

function formatUsd(amount: number): string {
  if (amount === 0) return '$0.0000';
  if (amount < 0.0001) return '<$0.0001';
  return `$${amount.toFixed(4)}`;
}

function variation(current: number, previous: number): number | null {
  if (previous <= 0) return current <= 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function variationLabel(value: number | null): string {
  if (value === null) return 'Nouveau';
  if (Math.abs(value) < 0.05) return 'Stable';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)} %`;
}

function smoothPath(coords: Array<{ x: number; y: number }>): string {
  if (coords.length === 0) return '';
  if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;

  let path = `M ${coords[0].x.toFixed(2)} ${coords[0].y.toFixed(2)}`;
  for (let index = 1; index < coords.length; index += 1) {
    const previous = coords[index - 1];
    const current = coords[index];
    const midX = (previous.x + current.x) / 2;
    path += ` C ${midX.toFixed(2)} ${previous.y.toFixed(2)}, ${midX.toFixed(2)} ${current.y.toFixed(2)}, ${current.x.toFixed(2)} ${current.y.toFixed(2)}`;
  }
  return path;
}

function downloadCsv(point: AiCostHistoryPoint) {
  const rows = [
    ['Fonction produit', 'Provider', 'Endpoint', 'Appels', 'Coût estimé (USD)'],
    ...point.details.map((row) => [row.feature, row.provider, row.endpoint, String(row.calls), row.cost.toFixed(6)]),
    ['Total', '', '', String(point.calls), point.cost.toFixed(6)],
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `couts-ia-${point.key}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function AiCostHistoryChart({ points }: AiCostHistoryChartProps) {
  const [selectedKey, setSelectedKey] = useState(points[points.length - 1]?.key ?? '');
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [view, setView] = useState<'line' | 'area'>('line');

  const current = points[points.length - 1];
  const previous = points[points.length - 2];
  const selected = points.find((point) => point.key === selectedKey) ?? current;
  const reversedPoints = useMemo(() => [...points].reverse(), [points]);
  const totalCost = points.reduce((sum, point) => sum + point.cost, 0);
  const totalCalls = points.reduce((sum, point) => sum + point.calls, 0);
  const averageCost = points.length > 0 ? totalCost / points.length : 0;
  const currentVariation = variation(current?.cost ?? 0, previous?.cost ?? 0);

  const width = 960;
  const height = 300;
  const left = 64;
  const right = 26;
  const top = 32;
  const bottom = 54;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxRaw = Math.max(...points.map((point) => point.cost), 0.0001);
  const maxCost = maxRaw * 1.15;
  const xFor = (index: number) => left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yFor = (cost: number) => top + plotHeight - (cost / maxCost) * plotHeight;
  const coords = points.map((point, index) => ({ x: xFor(index), y: yFor(point.cost) }));
  const linePath = smoothPath(coords);
  const areaPath = coords.length > 0
    ? `${linePath} L ${coords[coords.length - 1].x.toFixed(2)} ${(top + plotHeight).toFixed(2)} L ${coords[0].x.toFixed(2)} ${(top + plotHeight).toFixed(2)} Z`
    : '';
  const hoveredIndex = hoveredKey ? points.findIndex((point) => point.key === hoveredKey) : -1;
  const hovered = hoveredIndex >= 0 ? points[hoveredIndex] : null;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-950 dark:text-white">Évolution des coûts IA</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Coût provider estimé · 12 derniers mois · cliquez sur un mois pour l’inspecter</p>
          </div>
          <div className="inline-flex w-fit rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950/60" aria-label="Affichage du graphique">
            <button
              type="button"
              onClick={() => setView('line')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${view === 'line' ? 'bg-white text-violet-700 shadow-sm dark:bg-gray-800 dark:text-violet-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              Ligne
            </button>
            <button
              type="button"
              onClick={() => setView('area')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${view === 'area' ? 'bg-white text-violet-700 shadow-sm dark:bg-gray-800 dark:text-violet-300' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              Aire
            </button>
          </div>
        </div>

        <div className="overflow-x-auto px-3 pb-2 pt-4 sm:px-5">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto min-w-[720px] w-full"
            role="img"
            aria-label="Évolution mensuelle des coûts IA estimés sur douze mois"
          >
            <defs>
              <linearGradient id="aiCostLineSubtle" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#7C3AED" />
                <stop offset="52%" stopColor="#C026D3" />
                <stop offset="100%" stopColor="#F59E0B" />
              </linearGradient>
              <linearGradient id="aiCostAreaSubtle" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#C026D3" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.015" />
              </linearGradient>
            </defs>

            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = top + plotHeight * ratio;
              const value = maxCost * (1 - ratio);
              return (
                <g key={ratio}>
                  <line x1={left} x2={width - right} y1={y} y2={y} stroke="#E2E8F0" strokeWidth="1" strokeDasharray="4 6" />
                  <text x={left - 10} y={y + 4} textAnchor="end" fill="#94A3B8" fontSize="10">{formatUsd(value)}</text>
                </g>
              );
            })}

            {view === 'area' && areaPath && <path d={areaPath} fill="url(#aiCostAreaSubtle)" />}
            {linePath && <path d={linePath} fill="none" stroke="url(#aiCostLineSubtle)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}

            {points.map((point, index) => {
              const x = xFor(index);
              const y = yFor(point.cost);
              const isSelected = point.key === selected?.key;
              return (
                <g
                  key={point.key}
                  role="button"
                  tabIndex={0}
                  aria-label={`${point.fullLabel}, ${formatUsd(point.cost)}, ${point.calls} appels`}
                  className="cursor-pointer outline-none"
                  onClick={() => setSelectedKey(point.key)}
                  onMouseEnter={() => setHoveredKey(point.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onFocus={() => setHoveredKey(point.key)}
                  onBlur={() => setHoveredKey(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedKey(point.key);
                    }
                  }}
                >
                  {isSelected && <line x1={x} x2={x} y1={top} y2={top + plotHeight} stroke="#7C3AED" strokeOpacity="0.16" strokeDasharray="4 6" />}
                  <circle cx={x} cy={y} r={isSelected ? 8 : 6} fill="#FFFFFF" stroke={isSelected ? '#7C3AED' : '#D946EF'} strokeWidth={isSelected ? 3 : 2} />
                  <circle cx={x} cy={y} r="2.5" fill={isSelected ? '#7C3AED' : '#D946EF'} />
                  <text x={x} y={height - 22} textAnchor="middle" fill={isSelected ? '#6D28D9' : '#64748B'} fontSize="10.5" fontWeight={isSelected ? '700' : '500'}>
                    {point.label}
                  </text>
                </g>
              );
            })}

            {hovered && hoveredIndex >= 0 && (() => {
              const x = xFor(hoveredIndex);
              const y = yFor(hovered.cost);
              const boxWidth = 142;
              const boxHeight = 54;
              const boxX = Math.min(Math.max(left, x - boxWidth / 2), width - right - boxWidth);
              const boxY = Math.max(6, y - 70);
              return (
                <g pointerEvents="none">
                  <rect x={boxX} y={boxY} width={boxWidth} height={boxHeight} rx="10" fill="#FFFFFF" stroke="#E2E8F0" />
                  <text x={boxX + 12} y={boxY + 18} fill="#334155" fontSize="10" fontWeight="700">{hovered.fullLabel}</text>
                  <text x={boxX + 12} y={boxY + 35} fill="#7C3AED" fontSize="11" fontWeight="700">{formatUsd(hovered.cost)}</text>
                  <text x={boxX + boxWidth - 12} y={boxY + 35} textAnchor="end" fill="#64748B" fontSize="10">{hovered.calls} appels</text>
                </g>
              );
            })()}
          </svg>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-900 dark:bg-violet-950/20">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-violet-700 dark:text-violet-300">Ce mois</p>
          <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{formatUsd(current?.cost ?? 0)}</p>
          <p className="mt-1 text-xs text-gray-500">{current?.calls ?? 0} appels</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-emerald-700 dark:text-emerald-300">Tendance vs mois précédent</p>
          <p className={`mt-2 text-lg font-bold ${currentVariation !== null && currentVariation > 0 ? 'text-orange-700 dark:text-orange-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
            {variationLabel(currentVariation)}
          </p>
          <p className="mt-1 text-xs text-gray-500">{currentVariation !== null && currentVariation < 0 ? 'Moins de coûts' : currentVariation !== null && currentVariation > 0 ? 'Coût en hausse' : 'Évolution mensuelle'}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-amber-700 dark:text-amber-300">Cumul 12 mois</p>
          <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{formatUsd(totalCost)}</p>
          <p className="mt-1 text-xs text-gray-500">{totalCalls} appels</p>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-900 dark:bg-sky-950/20">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-sky-700 dark:text-sky-300">Coût moyen / mois</p>
          <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-white">{formatUsd(averageCost)}</p>
          <p className="mt-1 text-xs text-gray-500">Sur 12 mois</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-950 dark:text-white">Détail des coûts par mois</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Sélectionnez un mois pour consulter provider, endpoint, appels et coût estimé.</p>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
          <div className="border-b border-gray-100 dark:border-gray-800 lg:border-b-0 lg:border-r">
            <div className="hidden grid-cols-[1.2fr_0.8fr_0.65fr_0.9fr_32px] gap-3 border-b border-gray-100 bg-gray-50/70 px-4 py-2.5 text-[11px] font-medium text-gray-400 dark:border-gray-800 dark:bg-gray-950/40 sm:grid">
              <span>Mois</span><span>Coût total</span><span>Appels</span><span>Variation</span><span />
            </div>
            <div className="max-h-[530px] overflow-y-auto">
              {reversedPoints.map((point, reverseIndex) => {
                const originalIndex = points.length - 1 - reverseIndex;
                const previousPoint = originalIndex > 0 ? points[originalIndex - 1] : null;
                const value = variation(point.cost, previousPoint?.cost ?? 0);
                const active = point.key === selected?.key;
                const isCurrent = point.key === current?.key;
                return (
                  <button
                    key={point.key}
                    type="button"
                    onClick={() => setSelectedKey(point.key)}
                    className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-gray-100 px-4 py-3 text-left transition last:border-0 dark:border-gray-800 sm:grid-cols-[1.2fr_0.8fr_0.65fr_0.9fr_32px] ${active ? 'bg-violet-50/80 ring-1 ring-inset ring-violet-300 dark:bg-violet-950/25 dark:ring-violet-800' : 'hover:bg-gray-50 dark:hover:bg-gray-950/40'}`}
                  >
                    <span className="min-w-0">
                      <span className="font-semibold text-gray-900 dark:text-white">{point.fullLabel}</span>
                      {isCurrent && <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-950 dark:text-violet-300">Actuel</span>}
                    </span>
                    <span className="font-semibold text-gray-900 dark:text-white sm:block">{formatUsd(point.cost)}</span>
                    <span className="hidden text-gray-600 dark:text-gray-300 sm:block">{point.calls}</span>
                    <span className={`hidden text-xs font-semibold sm:block ${value !== null && value > 0 ? 'text-orange-600' : value !== null && value < 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{variationLabel(value)}</span>
                    <span className="hidden text-center text-gray-400 sm:block">{active ? '⌃' : '⌄'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-violet-600 dark:text-violet-300">Détail technique</p>
                <h3 className="mt-1 text-base font-semibold text-gray-950 dark:text-white">{selected?.fullLabel ?? 'Mois sélectionné'}</h3>
              </div>
              {selected && selected.details.length > 0 && (
                <button
                  type="button"
                  onClick={() => downloadCsv(selected)}
                  className="rounded-xl border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/30"
                >
                  Exporter CSV
                </button>
              )}
            </div>

            {!selected || selected.details.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-5 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-950/30 dark:text-gray-400">
                Aucune utilisation IA enregistrée pour ce mois.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800">
                <table className="w-full min-w-[500px] text-xs">
                  <thead>
                    <tr className="bg-gray-50/80 text-left text-[10px] uppercase tracking-[0.08em] text-gray-400 dark:bg-gray-950/50">
                      <th className="px-3 py-2.5 font-medium">Fonction / Endpoint</th>
                      <th className="px-3 py-2.5 font-medium">Provider</th>
                      <th className="px-3 py-2.5 text-right font-medium">Appels</th>
                      <th className="px-3 py-2.5 text-right font-medium">Coût</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.details.map((row) => (
                      <tr key={`${row.provider}-${row.endpoint}`} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="px-3 py-3">
                          <p className="font-semibold text-gray-800 dark:text-gray-200">{row.feature}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-gray-400">{row.endpoint}</p>
                        </td>
                        <td className="px-3 py-3 text-gray-600 dark:text-gray-300">{row.provider}</td>
                        <td className="px-3 py-3 text-right font-semibold text-gray-900 dark:text-white">{row.calls}</td>
                        <td className="px-3 py-3 text-right font-semibold text-gray-900 dark:text-white">{formatUsd(row.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-gray-200 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-950/40">
                      <td colSpan={2} className="px-3 py-3 font-semibold text-gray-700 dark:text-gray-200">Total</td>
                      <td className="px-3 py-3 text-right font-bold text-gray-950 dark:text-white">{selected.calls}</td>
                      <td className="px-3 py-3 text-right font-bold text-gray-950 dark:text-white">{formatUsd(selected.cost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <p className="mt-3 text-[11px] text-gray-400">Coûts estimés à partir des tarifs provider enregistrés pour chaque appel.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
