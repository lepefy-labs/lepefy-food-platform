import { heatmapLevel, type HeatmapGrid } from '@/lib/admin/salesStatistics';
import { CHART_SEQUENTIAL } from './chartTheme';

/**
 * Day × time-slot grid, one sequential hue (light → dark = more orders).
 * Each cell carries its count in a tooltip and the same grid is a real
 * table for screen readers.
 */
export default function Heatmap({ grid, rows, columns, unit }: { grid: HeatmapGrid; rows: readonly string[]; columns: readonly string[]; unit: [string, string] }) {
  const label = (value: number) => `${value} ${value > 1 ? unit[1] : unit[0]}`;
  return (
    <div className="flex flex-col gap-3">
      <table className="w-full table-fixed border-separate text-xs text-a-text-3" style={{ borderSpacing: 3 }}>
        <thead>
          <tr>
            <th scope="col" className="w-10"><span className="sr-only">Jour</span></th>
            {columns.map((column) => <th key={column} scope="col" className="text-center font-normal">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.cells.map((line, day) => (
            <tr key={rows[day]}>
              <th scope="row" className="text-left font-normal">{rows[day]}</th>
              {line.map((value, slot) => {
                const level = heatmapLevel(value, grid.max);
                return (
                  <td key={slot} title={`${rows[day]} ${columns[slot]} : ${label(value)}`} className="h-6 rounded p-0 sm:h-7" style={{ background: CHART_SEQUENTIAL[level] }}>
                    <span className="sr-only">{label(value)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-a-text-3">
        <span>Moins</span>
        {CHART_SEQUENTIAL.slice(1).map((color) => <span key={color} aria-hidden="true" className="h-2.5 w-3.5 rounded-sm" style={{ background: color }} />)}
        <span>Plus</span>
        {grid.peak && <span className="ml-1 text-a-text-2">· pic : <b className="font-semibold text-a-text">{grid.peak}</b></span>}
      </p>
    </div>
  );
}
