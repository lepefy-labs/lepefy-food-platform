'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { niceTicks } from '@/lib/admin/salesStatistics';
import { cn } from '@/lib/utils/cn';
import { CHART_ACCENT, CHART_GRID, CHART_MUTED, formatAxisValue, formatChartValue, type ChartValueFormat } from './chartTheme';

export interface TrendPoint {
  key: string;
  /** Short axis label (« 13 oct. »). */
  axisLabel: string;
  /** Tooltip title (« mar. 13 oct. »). */
  title: string;
  value: number | null;
  /** Extra tooltip line (« ce jour : 2 commandes · 190 € »). */
  detail?: string;
}

interface TrendChartProps {
  points: TrendPoint[];
  /** Previous period aligned by index (same bucket count, shorter is fine). */
  previous?: Array<number | null>;
  currentLabel: string;
  previousLabel?: string;
  format: ChartValueFormat;
  currency?: string;
  /** area = continuous line + wash (cumulative); bars = one column per bucket. */
  mode: 'area' | 'bars';
  ariaLabel: string;
  className?: string;
}

const PAD = { top: 24, right: 16, bottom: 30, left: 56 };
const MOBILE_BREAK = 520;

/** Path of the defined runs of a series (null breaks the line). */
function linePath(values: Array<number | null>, x: (index: number) => number, y: (value: number) => number): string {
  let path = '';
  let open = false;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) { open = false; return; }
    path += `${open ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)} `;
    open = true;
  });
  return path.trim();
}

/** Column with a 4 px rounded data end, square on the baseline. */
function columnPath(x: number, width: number, top: number, base: number): string {
  const height = base - top;
  if (height <= 0) return '';
  const r = Math.min(4, width / 2, height);
  return `M${x} ${base} V${top + r} Q${x} ${top} ${x + r} ${top} H${x + width - r} Q${x + width} ${top} ${x + width} ${top + r} V${base} Z`;
}

/**
 * Responsive time-series chart (SVG, no dependency). Width follows the
 * container (ResizeObserver), so text never scales; crosshair + tooltip on
 * pointer and touch, arrow keys when focused. Values stay readable without
 * colour: legend, end label and the page's « Voir les données » table.
 */
export default function TrendChart({ points, previous, currentLabel, previousLabel, format, currency = 'EUR', mode, ariaLabel, className }: TrendChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, '');

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setWidth(Math.max(240, Math.round(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const compact = width < MOBILE_BREAK;
  const height = compact ? 220 : 280;
  const pad = compact ? { ...PAD, left: 44, right: 10 } : PAD;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const values = points.map((point) => point.value);
  const prev = useMemo(() => (previous ?? []).slice(0, points.length), [previous, points.length]);

  const max = Math.max(0, ...values.map((value) => value ?? 0), ...prev.map((value) => value ?? 0));
  const ticks = niceTicks(max, compact ? 3 : 4);
  const top = ticks[ticks.length - 1]!;
  const count = points.length;
  const band = count > 0 ? plotW / count : plotW;
  const x = useCallback((index: number) => (mode === 'bars'
    ? pad.left + band * index + band / 2
    : pad.left + (count <= 1 ? plotW / 2 : (index / (count - 1)) * plotW)), [mode, pad.left, band, count, plotW]);
  const y = (value: number) => pad.top + plotH - (value / top) * plotH;
  const base = pad.top + plotH;

  const labelEvery = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(plotW / (compact ? 64 : 84)))));
  const lastIndex = (() => { for (let index = count - 1; index >= 0; index -= 1) if (values[index] !== null) return index; return -1; })();

  const indexAt = (clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || count === 0) return null;
    const px = clientX - rect.left;
    const raw = mode === 'bars' ? (px - pad.left) / band - 0.5 : ((px - pad.left) / plotW) * (count - 1);
    return Math.min(count - 1, Math.max(0, Math.round(raw)));
  };
  const onPointer = (event: PointerEvent<HTMLDivElement>) => setActive(indexAt(event.clientX));
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setActive((current) => {
        const start = current ?? (event.key === 'ArrowRight' ? -1 : count);
        return Math.min(count - 1, Math.max(0, start + (event.key === 'ArrowRight' ? 1 : -1)));
      });
    } else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
    else if (event.key === 'End') { event.preventDefault(); setActive(count - 1); }
    else if (event.key === 'Escape') setActive(null);
  };

  const barWidth = Math.max(2, Math.min(24, band * 0.62));
  const activePoint = active !== null ? points[active] : null;
  const tooltipLeft = active !== null ? Math.min(Math.max(x(active), 90), width - 90) : 0;

  return (
    <div className={cn('relative', className)}>
      <div
        ref={containerRef}
        role="group"
        aria-label={`${ariaLabel}. Flèches gauche et droite pour lire chaque point.`}
        tabIndex={0}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setActive(null)}
        onPointerCancel={() => setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        className="touch-pan-y select-none rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-focus"
      >
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} aria-hidden="true" className="block overflow-visible">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: CHART_ACCENT, stopOpacity: 0.22 }} />
              <stop offset="1" style={{ stopColor: CHART_ACCENT, stopOpacity: 0.02 }} />
            </linearGradient>
          </defs>

          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} strokeWidth={1}
                style={{ stroke: tick === 0 ? 'var(--admin-border-strong)' : CHART_GRID }} />
              <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={12} className="fill-a-text-3 tabular-nums">{formatAxisValue(tick, format, currency)}</text>
            </g>
          ))}

          {points.map((point, index) => (index % labelEvery === 0 ? (
            <text key={point.key} x={x(index)} y={height - 8} fontSize={12} className="fill-a-text-3"
              textAnchor={mode === 'area' && index === 0 ? 'start' : 'middle'}>{point.axisLabel}</text>
          ) : null))}

          {mode === 'bars' && points.map((point, index) => (point.value ? (
            <path key={point.key} d={columnPath(x(index) - barWidth / 2, barWidth, y(point.value), base)}
              style={{ fill: CHART_ACCENT, opacity: active === null || active === index ? 1 : 0.45 }} />
          ) : null))}

          {prev.length > 0 && (
            <path d={linePath(prev, x, y)} fill="none" strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" strokeLinejoin="round"
              style={{ stroke: CHART_MUTED }} />
          )}

          {mode === 'area' && lastIndex >= 0 && (
            <>
              <path d={`${linePath(values, x, y)} L${x(lastIndex).toFixed(1)} ${base} L${x(values.findIndex((value) => value !== null)).toFixed(1)} ${base} Z`}
                style={{ fill: `url(#${gradientId})` }} />
              <path d={linePath(values, x, y)} fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: CHART_ACCENT }} />
            </>
          )}

          {mode === 'area' && lastIndex >= 0 && active === null && (
            <>
              <circle cx={x(lastIndex)} cy={y(values[lastIndex]!)} r={5} strokeWidth={2} style={{ fill: CHART_ACCENT, stroke: 'var(--admin-surface)' }} />
              <text x={Math.min(x(lastIndex), width - pad.right)} y={y(values[lastIndex]!) - 12} textAnchor="end" fontSize={12} fontWeight={700} className="fill-a-text tabular-nums">
                {formatChartValue(values[lastIndex], format, currency)}
              </text>
            </>
          )}

          {active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={pad.top} y2={base} strokeWidth={1} style={{ stroke: 'var(--admin-text-3)', opacity: 0.5 }} />
              {prev[active] !== undefined && prev[active] !== null && (
                <circle cx={x(active)} cy={y(prev[active]!)} r={4.5} strokeWidth={2} style={{ fill: CHART_MUTED, stroke: 'var(--admin-surface)' }} />
              )}
              {mode === 'area' && values[active] !== null && (
                <circle cx={x(active)} cy={y(values[active]!)} r={5.5} strokeWidth={2} style={{ fill: CHART_ACCENT, stroke: 'var(--admin-surface)' }} />
              )}
            </g>
          )}
        </svg>
      </div>

      <div aria-live="polite" className="sr-only">
        {activePoint ? `${activePoint.title} : ${formatChartValue(activePoint.value, format, currency)}${activePoint.detail ? `, ${activePoint.detail}` : ''}` : ''}
      </div>

      {activePoint && (
        <div aria-hidden="true" style={{ left: tooltipLeft }}
          className="pointer-events-none absolute top-0 z-10 min-w-44 max-w-[calc(100%-8px)] -translate-x-1/2 rounded-xl bg-a-inverse px-3 py-2 text-xs text-a-on-inverse shadow-lg">
          <p className="font-semibold">{activePoint.title}</p>
          <p className="mt-1 flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 rounded" style={{ background: CHART_ACCENT }} />{currentLabel}</span>
            <b className="tabular-nums">{formatChartValue(activePoint.value, format, currency)}</b>
          </p>
          {activePoint.detail && <p className="mt-0.5 opacity-80">{activePoint.detail}</p>}
          {previousLabel && active !== null && prev[active] !== undefined && (
            <p className="mt-0.5 flex items-center justify-between gap-4 opacity-80">
              <span className="inline-flex items-center gap-1.5"><span className="w-3 border-t-2 border-dashed" style={{ borderColor: CHART_MUTED }} />{previousLabel}</span>
              <span className="tabular-nums">{formatChartValue(prev[active], format, currency)}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
