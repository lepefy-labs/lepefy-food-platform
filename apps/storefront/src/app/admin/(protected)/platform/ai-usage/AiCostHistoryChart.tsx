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
  const [first, ...rest] = coords;
  if (!first) return '';
  let path = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
  let previous = first;
  for (const current of rest) {
    const midX = (previous.x + current.x) / 2;
    path += ` C ${midX.toFixed(2)} ${previous.y.toFixed(2)}, ${midX.toFixed(2)} ${current.y.toFixed(2)}, ${current.x.toFixed(2)} ${current.y.toFixed(2)}`;
    previous = current;
  }
  return path;
}

function downloadCsv(point: AiCostHistoryPoint) {
  const rows = [
    ['Fonction produit', 'Provider', 'Endpoint', 'Appels', 'Coût estimé (USD)'],
    ...point.details.map((row) => [row.feature, row.provider, row.endpoint, String(row.calls), row.cost.toFixed(6)]),
    ['Total', '', '', String(point.calls), point.cost.toFixed(6)],
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
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
  const current = points.at(-1) ?? null;
  const previous = points.at(-2) ?? null;
  const [selectedKey, setSelectedKey] = useState(current?.key ?? '');
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [view, setView] = useState<'line' | 'area'>('line');

  const selected = points.find((point) => point.key === selectedKey) ?? current;
  const hovered = hoveredKey ? points.find((point) => point.key === hoveredKey) ?? null : null;
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
  const maxCost = Math.max(...points.map((point) => point.cost), 0.0001) * 1.15;
  const xFor = (index: number) => left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yFor = (cost: number) => top + plotHeight - (cost / maxCost) * plotHeight;
  const coords = points.map((point, index) => ({ x: xFor(index), y: yFor(point.cost) }));
  const linePath = smoothPath(coords);
  const firstCoord = coords.at(0) ?? null;
  const lastCoord = coords.at(-1) ?? null;
  const areaPath = firstCoord && lastCoord
    ? `${linePath} L ${lastCoord.x.toFixed(2)} ${(top + plotHeight).toFixed(2)} L ${firstCoord.x.toFixed(2)} ${(top + plotHeight).toFixed(2)} Z`
    : '';
  const hoveredIndex = hovered ? points.findIndex((point) => point.key === hovered.key) : -1;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-a-border bg-a-surface shadow-sm">
        <div className="flex flex-col gap-3 border-b border-a-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-a-text">Évolution des coûts IA</h2>
            <p className="mt-1 text-xs text-a-text-3">Coût provider estimé · 12 derniers mois · cliquez sur un mois pour l’inspecter</p>
          </div>
          <div className="inline-flex w-fit rounded-xl border border-a-border bg-a-surface-2 p-1" aria-label="Affichage du graphique">
            {(['line', 'area'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${view === mode ? 'bg-a-surface text-a-brand-fg shadow-sm' : 'text-a-text-3 hover:text-a-text'}`}
              >
                {mode === 'line' ? 'Ligne' : 'Aire'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto px-3 pb-2 pt-4 sm:px-5">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-auto min-w-[720px] w-full" role="img" aria-label="Évolution mensuelle des coûts IA estimés sur douze mois">
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
                  <text x={x} y={height - 22} textAnchor="middle" fill={isSelected ? '#6D28D9' : '#64748B'} fontSize="10.5" fontWeight={isSelected ? '700' : '500'}>{point.label}</text>
                </g>
              );
            })}

            {hovered && hoveredIndex >= 0 ? (() => {
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
            })() : null}
          </svg>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-a-border bg-a-brand-soft p-4">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-a-brand-fg">Ce mois</p>
          <p className="mt-2 text-2xl font-bold text-a-text">{formatUsd(current?.cost ?? 0)}</p>
          <p className="mt-1 text-xs text-a-text-3">{current?.calls ?? 0} appels</p>
        </div>
        <div className="rounded-2xl border border-tone-success-border bg-tone-success-bg p-4">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-tone-success-fg">Tendance vs mois précédent</p>
          <p className={`mt-2 text-lg font-bold ${currentVariation !== null && currentVariation > 0 ? 'text-tone-urgent-fg' : 'text-tone-success-fg'}`}>{variationLabel(currentVariation)}</p>
          <p className="mt-1 text-xs text-a-text-3">{currentVariation !== null && currentVariation < 0 ? 'Moins de coûts' : currentVariation !== null && currentVariation > 0 ? 'Coût en hausse' : 'Évolution mensuelle'}</p>
        </div>
        <div className="rounded-2xl border border-tone-warning-border bg-tone-warning-bg p-4">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-tone-warning-fg">Cumul 12 mois</p>
          <p className="mt-2 text-2xl font-bold text-a-text">{formatUsd(totalCost)}</p>
          <p className="mt-1 text-xs text-a-text-3">{totalCalls} appels</p>
        </div>
        <div className="rounded-2xl border border-tone-info-border bg-tone-info-bg p-4">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-tone-info-fg">Coût moyen / mois</p>
          <p className="mt-2 text-2xl font-bold text-a-text">{formatUsd(averageCost)}</p>
          <p className="mt-1 text-xs text-a-text-3">Sur 12 mois</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-a-border bg-a-surface shadow-sm">
        <div className="border-b border-a-border px-5 py-4">
          <h2 className="text-sm font-semibold text-a-text">Détail des coûts par mois</h2>
          <p className="mt-1 text-xs text-a-text-3">Sélectionnez un mois pour consulter provider, endpoint, appels et coût estimé.</p>
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
          <div className="border-b border-a-border lg:border-b-0 lg:border-r">
            <div className="hidden grid-cols-[1.2fr_0.8fr_0.65fr_0.9fr_32px] gap-3 border-b border-a-border bg-a-surface-2 px-4 py-2.5 text-xs font-medium text-a-text-3 sm:grid">
              <span>Mois</span><span>Coût total</span><span>Appels</span><span>Variation</span><span />
            </div>
            <div className="max-h-[530px] overflow-y-auto">
              {reversedPoints.map((point, reverseIndex) => {
                const originalIndex = points.length - 1 - reverseIndex;
                const previousPoint = originalIndex > 0 ? points.at(originalIndex - points.length - 1) ?? null : null;
                const value = variation(point.cost, previousPoint?.cost ?? 0);
                const active = point.key === selected?.key;
                const isCurrent = point.key === current?.key;
                return (
                  <button
                    key={point.key}
                    type="button"
                    onClick={() => setSelectedKey(point.key)}
                    className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-a-border px-4 py-3 text-left transition last:border-0 sm:grid-cols-[1.2fr_0.8fr_0.65fr_0.9fr_32px] ${active ? 'bg-a-brand-soft ring-1 ring-inset ring-a-border' : 'hover:bg-a-surface-2'}`}
                  >
                    <span className="min-w-0">
                      <span className="font-semibold text-a-text">{point.fullLabel}</span>
                      {isCurrent && <span className="ml-2 rounded-full bg-a-brand-soft px-2 py-0.5 text-xs font-bold text-a-brand-fg">Actuel</span>}
                    </span>
                    <span className="font-semibold text-a-text">{formatUsd(point.cost)}</span>
                    <span className="hidden text-a-text-2 sm:block">{point.calls}</span>
                    <span className={`hidden text-xs font-semibold sm:block ${value !== null && value > 0 ? 'text-tone-urgent-fg' : value !== null && value < 0 ? 'text-tone-success-fg' : 'text-a-text-3'}`}>{variationLabel(value)}</span>
                    <span className="hidden text-center text-a-text-3 sm:block">{active ? '⌃' : '⌄'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-a-brand-fg">Détail technique</p>
                <h3 className="mt-1 text-base font-semibold text-a-text">{selected?.fullLabel ?? 'Mois sélectionné'}</h3>
              </div>
              {selected && selected.details.length > 0 && (
                <button type="button" onClick={() => downloadCsv(selected)} className="rounded-xl border border-a-border px-3 py-2 text-xs font-semibold text-a-brand-fg transition hover:bg-a-brand-soft">Exporter CSV</button>
              )}
            </div>

            {!selected || selected.details.length === 0 ? (
              <div className="rounded-xl border border-dashed border-a-border bg-a-surface-2 p-5 text-sm text-a-text-3">Aucune utilisation IA enregistrée pour ce mois.</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-a-border">
                <table className="w-full min-w-[500px] text-xs">
                  <thead>
                    <tr className="bg-a-surface-2 text-left text-xs uppercase tracking-[0.08em] text-a-text-3">
                      <th className="px-3 py-2.5 font-medium">Fonction / Endpoint</th>
                      <th className="px-3 py-2.5 font-medium">Provider</th>
                      <th className="px-3 py-2.5 text-right font-medium">Appels</th>
                      <th className="px-3 py-2.5 text-right font-medium">Coût</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.details.map((row) => (
                      <tr key={`${row.provider}-${row.endpoint}`} className="border-t border-a-border">
                        <td className="px-3 py-3"><p className="font-semibold text-a-text">{row.feature}</p><p className="mt-0.5 font-mono text-xs text-a-text-3">{row.endpoint}</p></td>
                        <td className="px-3 py-3 text-a-text-2">{row.provider}</td>
                        <td className="px-3 py-3 text-right font-semibold text-a-text">{row.calls}</td>
                        <td className="px-3 py-3 text-right font-semibold text-a-text">{formatUsd(row.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-a-border bg-a-surface-2">
                      <td colSpan={2} className="px-3 py-3 font-semibold text-a-text-2">Total</td>
                      <td className="px-3 py-3 text-right font-bold text-a-text">{selected.calls}</td>
                      <td className="px-3 py-3 text-right font-bold text-a-text">{formatUsd(selected.cost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-a-text-3">Coûts estimés à partir des tarifs provider enregistrés pour chaque appel.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
