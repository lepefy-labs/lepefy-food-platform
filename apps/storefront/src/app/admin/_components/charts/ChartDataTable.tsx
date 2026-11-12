import { IconTable } from '@tabler/icons-react';

/** « Voir les données » under a chart: the exact values as a table (keyboard, screen reader, copy). */
export default function ChartDataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: string[][] }) {
  if (rows.length === 0) return null;
  return (
    <details className="group min-w-0 max-w-full text-sm">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-1 font-semibold text-a-brand-fg hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus [&::-webkit-details-marker]:hidden">
        <IconTable size={16} aria-hidden="true" />
        <span className="group-open:hidden">Voir les données</span>
        <span className="hidden group-open:inline">Masquer les données</span>
      </summary>
      <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-a-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-a-surface-2 text-xs font-semibold text-a-text-2">
            <tr>{columns.map((column, index) => <th key={column} scope="col" className={index ? 'px-3 py-2 text-right' : 'px-3 py-2'}>{column}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-a-border">
            {rows.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, index) => index === 0
                  ? <th key={index} scope="row" className="px-3 py-1.5 font-normal text-a-text">{cell}</th>
                  : <td key={index} className="px-3 py-1.5 text-right tabular-nums text-a-text">{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
