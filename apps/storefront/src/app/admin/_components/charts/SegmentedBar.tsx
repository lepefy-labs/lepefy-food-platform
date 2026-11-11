import { CHART_MUTED, CHART_SERIES } from './chartTheme';

export interface Segment { key: string; label: string; value: number; valueLabel: string }

/**
 * One whole split into parts (≤ 3 + « Autres »): 2 px surface gap between
 * segments, legend with the value of each part always visible (identity is
 * never colour alone). Colour slots follow the order given, so the caller
 * keeps a stable order per dimension.
 */
export default function SegmentedBar({ title, segments, empty = 'Aucune donnée' }: { title: string; segments: Segment[]; empty?: string }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const colorOf = (index: number, key: string) => (key === 'other' ? CHART_MUTED : CHART_SERIES[index % CHART_SERIES.length]);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-xs font-semibold text-a-text-2">{title}</figcaption>
      {total <= 0 ? <p className="text-sm text-a-text-3">{empty}</p> : (
        <>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded" aria-hidden="true">
            {segments.map((segment, index) => (
              <div key={segment.key} className="h-3 first:rounded-l last:rounded-r" style={{ flexGrow: segment.value, flexBasis: 0, minWidth: 3, background: colorOf(index, segment.key) }} />
            ))}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-a-text-2">
            {segments.map((segment, index) => (
              <li key={segment.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ background: colorOf(index, segment.key) }} />
                {segment.label} <b className="font-semibold tabular-nums text-a-text">{segment.valueLabel}</b>
              </li>
            ))}
          </ul>
        </>
      )}
    </figure>
  );
}
