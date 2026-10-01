import { GESTION_TIME_ZONE } from '@/lib/gestion/domain';
import type { ExportPeriod } from '@/lib/gestion/exportData';

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseExportPeriod(params: URLSearchParams): ExportPeriod | null {
  if ([...params.keys()].some((key) => key !== 'from' && key !== 'to')) return null;
  if (params.getAll('from').length > 1 || params.getAll('to').length > 1) return null;
  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  if ((rawFrom !== null && !validDate(rawFrom)) || (rawTo !== null && !validDate(rawTo)) ||
    (rawFrom && rawTo && rawFrom > rawTo)) return null;
  return { from: rawFrom ?? undefined, to: rawTo ?? undefined };
}

/** Convert a Gestion calendar boundary to UTC, including Paris DST changes. */
export function gestionMidnightUtc(day: string): string {
  const midnight = new Date(`${day}T00:00:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: GESTION_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(midnight).map((part) => [part.type, part.value]));
  const localAtUtcMidnight = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute));
  return new Date(midnight.getTime() - (localAtUtcMidnight - midnight.getTime())).toISOString();
}
