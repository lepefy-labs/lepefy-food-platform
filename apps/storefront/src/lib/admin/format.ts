/**
 * Admin formatting (fr-FR). One place for amounts, dates and weights so every
 * admin table shows the same information the same way. Pure: usable from
 * Server and Client Components and from unit tests.
 */

const LOCALE = 'fr-FR';
const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** `value` is in major units (euros), as stored on orders and customers. */
export function formatMoney(value: number | null | undefined, currency = 'EUR'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, { style: 'currency', currency });
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(value);
}

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits }).format(value);
}

/** Grams → "850 g" / "2,1 kg". */
export function formatWeight(grams: number | null | undefined): string {
  if (grams === null || grams === undefined || !Number.isFinite(grams)) return '—';
  return grams < 1000 ? `${formatNumber(grams)} g` : `${formatNumber(grams / 1000, 1)} kg`;
}

export type AdminDateStyle = 'date' | 'datetime' | 'time' | 'short';

const DATE_OPTIONS: Record<AdminDateStyle, Intl.DateTimeFormatOptions> = {
  date: { day: '2-digit', month: '2-digit', year: 'numeric' },
  datetime: { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' },
  time: { hour: '2-digit', minute: '2-digit' },
  short: { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' },
};

/**
 * Dates are shown in the shop's timezone (Europe/Rome by default) so server
 * and client render the same string.
 */
export function formatDate(value: string | Date | null | undefined, style: AdminDateStyle = 'date', timeZone = 'Europe/Rome'): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, { ...DATE_OPTIONS[style], timeZone }).format(date).replace(',', '');
}

/** "il y a 3 min", "il y a 2 h", "il y a 4 j" — coarse, for operational lists. */
export function formatRelative(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  const ms = now.getTime() - date.getTime();
  if (Number.isNaN(ms)) return '—';
  const future = ms < 0;
  const minutes = Math.round(Math.abs(ms) / 60_000);
  const text = minutes < 1 ? 'moins d’une minute'
    : minutes < 60 ? `${minutes} min`
    : minutes < 60 * 24 ? `${Math.round(minutes / 60)} h`
    : `${Math.round(minutes / (60 * 24))} j`;
  return future ? `dans ${text}` : `il y a ${text}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${Math.abs(count) > 1 ? plural : singular}`;
}
