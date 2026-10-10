'use client';

import { useMemo, useState } from 'react';

export interface TenantAiUsageFeature {
  key: string;
  label: string;
  description: string;
  usageCount: number;
  unitLabel: string;
}

export interface TenantAiUsageMonth {
  key: string;
  label: string;
  fullLabel: string;
  total: number;
  features: TenantAiUsageFeature[];
}

interface TenantAiUsageHistoryProps {
  months: TenantAiUsageMonth[];
}

function variationLabel(current: number, previous: number): { text: string; tone: string } {
  if (previous <= 0 && current <= 0) return { text: 'Stable', tone: 'text-a-text-3' };
  if (previous <= 0) return { text: 'Nouveau ce mois', tone: 'text-a-brand-fg' };
  const variation = ((current - previous) / previous) * 100;
  if (Math.abs(variation) < 0.05) return { text: 'Stable', tone: 'text-a-text-3' };
  return {
    text: `${variation > 0 ? '+' : ''}${variation.toFixed(1)} %`,
    tone: variation > 0 ? 'text-tone-warning-fg' : 'text-tone-success-fg',
  };
}

export default function TenantAiUsageHistory({ months }: TenantAiUsageHistoryProps) {
  const [selectedKey, setSelectedKey] = useState(months.at(-1)?.key ?? '');
  const selectedMonth = months.find((month) => month.key === selectedKey) ?? months.at(-1);
  const current = months.at(-1)?.total ?? 0;
  const previous = months.at(-2)?.total ?? 0;
  const cumulative = months.reduce((sum, month) => sum + month.total, 0);
  const average = months.length > 0 ? Math.round(cumulative / months.length) : 0;
  const trend = variationLabel(current, previous);

  const chart = useMemo(() => {
    const width = 860;
    const height = 260;
    const left = 42;
    const right = 22;
    const top = 24;
    const bottom = 48;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maxValue = Math.max(...months.map((month) => month.total), 1);
    const xFor = (index: number) => left + (months.length <= 1 ? plotWidth / 2 : (index / (months.length - 1)) * plotWidth);
    const yFor = (value: number) => top + plotHeight - (value / maxValue) * plotHeight;
    const coords = months.map((month, index) => ({ x: xFor(index), y: yFor(month.total) }));
    const first = coords.at(0);
    if (!first) return { width, height, left, right, top, plotHeight, maxValue, coords, linePath: '', areaPath: '' };
    const linePath = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
    const last = coords.at(-1) ?? first;
    const baseline = top + plotHeight;
    const areaPath = `${linePath} L ${last.x.toFixed(2)} ${baseline.toFixed(2)} L ${first.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
    return { width, height, left, right, top, plotHeight, maxValue, coords, linePath, areaPath };
  }, [months]);

  return (
    <>
      <section className="overflow-hidden rounded-2xl border border-a-border bg-a-surface shadow-sm">
        <div className="flex flex-col gap-2 border-b border-a-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-a-text">Évolution de l’utilisation IA</h2>
            <p className="mt-1 text-xs text-a-text-3">12 derniers mois · toutes fonctionnalités incluses</p>
          </div>
          <span className="w-fit rounded-full border border-a-border bg-a-brand-soft px-2.5 py-1 text-xs font-semibold text-a-brand-fg">12 mois</span>
        </div>

        <div className="p-4 sm:p-5">
          <div className="overflow-x-auto rounded-2xl border border-a-border bg-gradient-to-b from-a-surface to-a-brand-soft">
            <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-auto w-full min-w-[680px]" role="img" aria-label="Historique mensuel de l'utilisation des fonctionnalités IA">
              <defs>
                <linearGradient id="tenantAiLine" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#7C3AED" />
                  <stop offset="55%" stopColor="#8B5CF6" />
                  <stop offset="100%" stopColor="#2563EB" />
                </linearGradient>
                <linearGradient id="tenantAiArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.20" />
                  <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {[0, 0.5, 1].map((ratio) => {
                const y = chart.top + chart.plotHeight * ratio;
                const value = Math.round(chart.maxValue * (1 - ratio));
                return (
                  <g key={ratio}>
                    <line x1={chart.left} x2={chart.width - chart.right} y1={y} y2={y} stroke="#E2E8F0" strokeWidth="1" strokeDasharray="4 6" />
                    <text x={chart.left} y={Math.max(14, y - 7)} fill="#94A3B8" fontSize="10">{value}</text>
                  </g>
                );
              })}

              {chart.areaPath && <path d={chart.areaPath} fill="url(#tenantAiArea)" />}
              {chart.linePath && <path d={chart.linePath} fill="none" stroke="url(#tenantAiLine)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}

              {months.map((month, index) => {
                const point = chart.coords[index];
                if (!point) return null;
                const selected = month.key === selectedMonth?.key;
                return (
                  <g
                    key={month.key}
                    role="button"
                    tabIndex={0}
                    aria-label={`${month.fullLabel}, ${month.total} utilisations`}
                    onClick={() => setSelectedKey(month.key)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedKey(month.key); }}
                    className="cursor-pointer outline-none"
                  >
                    {selected && <line x1={point.x} x2={point.x} y1={chart.top} y2={chart.top + chart.plotHeight} stroke="#C4B5FD" strokeWidth="1.5" strokeDasharray="4 5" />}
                    <circle cx={point.x} cy={point.y} r={selected ? 7 : 5} fill={selected ? '#7C3AED' : '#FFFFFF'} stroke="#7C3AED" strokeWidth={selected ? 3 : 2.5}>
                      <title>{`${month.fullLabel}: ${month.total} utilisations`}</title>
                    </circle>
                    <text x={point.x} y={chart.height - 20} textAnchor="middle" fill={selected ? '#6D28D9' : '#64748B'} fontSize="10.5" fontWeight={selected ? '700' : '500'}>
                      {month.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-a-border bg-a-brand-soft p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-a-brand-fg">Ce mois</p>
              <p className="mt-2 text-2xl font-bold text-a-text">{current}</p>
              <p className="mt-1 text-xs text-a-text-3">utilisations</p>
            </div>
            <div className="rounded-xl border border-a-border bg-a-surface-2 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-a-text-3">Tendance</p>
              <p className={`mt-2 text-sm font-bold ${trend.tone}`}>{trend.text}</p>
              <p className="mt-1 text-xs text-a-text-3">vs mois précédent</p>
            </div>
            <div className="rounded-xl border border-tone-info-border bg-tone-info-bg p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-tone-info-fg">Moyenne / mois</p>
              <p className="mt-2 text-2xl font-bold text-a-text">{average}</p>
              <p className="mt-1 text-xs text-a-text-3">sur 12 mois</p>
            </div>
            <div className="rounded-xl border border-tone-success-border bg-tone-success-bg p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-tone-success-fg">Cumul 12 mois</p>
              <p className="mt-2 text-2xl font-bold text-a-text">{cumulative}</p>
              <p className="mt-1 text-xs text-a-text-3">utilisations</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="overflow-hidden rounded-2xl border border-a-border bg-a-surface shadow-sm">
          <div className="border-b border-a-border px-5 py-4">
            <h2 className="text-sm font-semibold text-a-text">Historique mensuel</h2>
            <p className="mt-1 text-xs text-a-text-3">Sélectionnez un mois pour afficher le détail.</p>
          </div>
          <div className="max-h-[520px] overflow-y-auto divide-y divide-a-border">
            {[...months].reverse().map((month, reverseIndex, reversed) => {
              const originalIndex = months.findIndex((candidate) => candidate.key === month.key);
              const previousMonth = originalIndex > 0 ? months[originalIndex - 1] : undefined;
              const variation = previousMonth ? variationLabel(month.total, previousMonth.total) : { text: '—', tone: 'text-a-text-3' };
              const active = month.key === selectedMonth?.key;
              return (
                <button
                  key={month.key}
                  type="button"
                  onClick={() => setSelectedKey(month.key)}
                  className={`flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-a-brand-soft focus:outline-none focus:ring-2 focus:ring-inset focus:ring-a-brand ${active ? 'bg-a-brand-soft' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-a-text">{month.fullLabel}</p>
                      {reverseIndex === 0 && <span className="rounded-full bg-a-brand-soft px-2 py-0.5 text-xs font-semibold text-a-brand-fg">Actuel</span>}
                    </div>
                    <p className={`mt-0.5 text-xs font-medium ${variation.tone}`}>{variation.text}{variation.text !== '—' ? ' vs mois précédent' : ''}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-bold text-a-text">{month.total}</p>
                    <p className="text-xs text-a-text-3">utilisations</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-a-border bg-a-surface shadow-sm">
          <div className="border-b border-a-border px-5 py-4">
            <h2 className="text-sm font-semibold text-a-text">Détail · {selectedMonth?.fullLabel ?? '—'}</h2>
            <p className="mt-1 text-xs text-a-text-3">Utilisation regroupée par fonctionnalité Lepefy.</p>
          </div>

          {!selectedMonth || selectedMonth.features.length === 0 ? (
            <p className="p-5 text-sm text-a-text-3">Aucune utilisation IA enregistrée pour ce mois.</p>
          ) : (
            <div className="divide-y divide-a-border">
              {selectedMonth.features.map((feature) => (
                <div key={feature.key} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-a-text">{feature.label}</p>
                    <p className="mt-0.5 text-xs text-a-text-3">{feature.description}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-bold text-a-text">{feature.usageCount}</p>
                    <p className="text-xs text-a-text-3">{feature.unitLabel}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
