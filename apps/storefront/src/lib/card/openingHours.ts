import { z } from 'zod';

/**
 * Horaires d'ouverture structurés du commerce (carte digitale), stockés dans
 * `tenant_feature_settings('digital_card').config.opening_hours` — aucune
 * migration. Les horaires texte (`tenants.click_collect_hours*`, lus par les
 * confirmations de retrait, Nala, WhatsApp et l'affiche) sont générés depuis
 * cette grille à l'enregistrement (`openingHoursText`).
 *
 * Tout est calculé dans le fuseau du commerce (jamais celui du visiteur).
 * Pur, testé dans tests/unit/cardLanding.spec.ts.
 */
export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
export const MAX_RANGES_PER_DAY = 3;

export const SUPPORTED_TIMEZONES = [
  'Europe/Rome', 'Europe/Paris', 'Europe/Brussels', 'Europe/Madrid', 'Europe/Berlin', 'Europe/Zurich',
  'Europe/Lisbon', 'Europe/London', 'Africa/Douala', 'Africa/Abidjan', 'Africa/Dakar', 'Africa/Lagos', 'Africa/Kinshasa',
] as const;

function minutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
}

const rangeSchema = z.object({
  open: z.string().regex(TIME, 'Heure invalide.'),
  close: z.string().regex(TIME, 'Heure invalide.'),
}).strict().refine((range) => minutes(range.close) > minutes(range.open), { message: 'La fermeture doit suivre l’ouverture.' });

const daySchema = z.array(rangeSchema).max(MAX_RANGES_PER_DAY).refine((ranges) => {
  const sorted = [...ranges].sort((a, b) => minutes(a.open) - minutes(b.open));
  return sorted.every((range, index) => index === 0 || minutes(range.open) >= minutes(sorted[index - 1]!.close));
}, { message: 'Les plages d’une même journée ne doivent pas se chevaucher.' });

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const MAX_CLOSURES = 30;
export const MAX_NOTE_LENGTH = 140;

/** Fermeture exceptionnelle, dates locales du commerce, bornes incluses. */
const closureSchema = z.object({
  from: z.string().regex(DATE, 'Date invalide.'),
  to: z.string().regex(DATE, 'Date invalide.'),
  label: z.string().trim().max(60, '60 caractères maximum.').optional(),
}).strict().refine((c) => c.to >= c.from, { message: 'La fin doit être le même jour ou après le début.' });

export const openingHoursSchema = z.object({
  timezone: z.enum(SUPPORTED_TIMEZONES),
  days: z.object(Object.fromEntries(DAY_KEYS.map((day) => [day, daySchema])) as Record<DayKey, typeof daySchema>).strict(),
  /** Jours fériés, congés… : « Fermé exceptionnellement » sur la carte. */
  closures: z.array(closureSchema).max(MAX_CLOSURES).optional(),
  /** Précision ajoutée au texte généré (« Fermé les jours fériés »). */
  note: z.object({
    fr: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
    it: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
  }).strict().optional(),
}).strict();

export type TimeRange = z.infer<typeof rangeSchema>;
export type Closure = z.infer<typeof closureSchema>;
export type OpeningHours = z.infer<typeof openingHoursSchema>;

/** Fuseau par défaut d'un tenant selon son pays (repli : Europe/Rome). */
export function defaultTimezone(country: string | null | undefined): OpeningHours['timezone'] {
  switch ((country ?? '').toUpperCase()) {
    case 'FR': return 'Europe/Paris';
    case 'BE': return 'Europe/Brussels';
    case 'ES': return 'Europe/Madrid';
    case 'DE': return 'Europe/Berlin';
    case 'CH': return 'Europe/Zurich';
    case 'PT': return 'Europe/Lisbon';
    case 'GB': case 'UK': return 'Europe/London';
    case 'CM': return 'Africa/Douala';
    default: return 'Europe/Rome';
  }
}

export function emptyWeek(): OpeningHours['days'] {
  return Object.fromEntries(DAY_KEYS.map((day) => [day, [] as TimeRange[]])) as OpeningHours['days'];
}

/** Jour et minute courants dans le fuseau du commerce. */
export function localNow(now: Date, timezone: string): { day: DayKey; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const day = get('weekday').toLowerCase().slice(0, 3) as DayKey;
  return { day: DAY_KEYS.includes(day) ? day : 'mon', minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

function sortedRanges(hours: OpeningHours, day: DayKey): TimeRange[] {
  return [...(hours.days[day] ?? [])].sort((a, b) => minutes(a.open) - minutes(b.open));
}

export type OpeningStatus =
  | { state: 'open'; closesAt: string }
  | {
    state: 'closed';
    /** Next opening; `date` (YYYY-MM-DD) only when it is a week or more away. */
    next: { dayOffset: number; day: DayKey; time: string; date?: string } | null;
    /** Present only on an exceptional closure day. */
    closure?: { label: string | null; to: string };
  };

/** Date (YYYY-MM-DD) in the shop time zone. */
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): DayKey {
  const [y, m, d] = date.split('-').map(Number);
  return DAY_KEYS[(new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay() + 6) % 7]!;
}

export function closureOn(hours: Pick<OpeningHours, 'closures'>, date: string): Closure | null {
  return (hours.closures ?? []).find((c) => date >= c.from && date <= c.to) ?? null;
}

/** Days looked ahead for the next opening (long holidays included). */
const LOOKAHEAD_DAYS = 120;

export function openingStatus(hours: OpeningHours, now: Date): OpeningStatus {
  const { day, minute } = localNow(now, hours.timezone);
  const today = localDate(now, hours.timezone);
  const closedToday = closureOn(hours, today);
  if (!closedToday) {
    const ranges = sortedRanges(hours, day);
    const current = ranges.find((range) => minute >= minutes(range.open) && minute < minutes(range.close));
    if (current) return { state: 'open', closesAt: current.close };
    const laterToday = ranges.find((range) => minutes(range.open) > minute);
    if (laterToday) return { state: 'closed', next: { dayOffset: 0, day, time: laterToday.open } };
  }
  let next: Extract<OpeningStatus, { state: 'closed' }>['next'] = null;
  for (let offset = 1; offset <= LOOKAHEAD_DAYS; offset += 1) {
    const date = addDays(today, offset);
    if (closureOn(hours, date)) continue;
    const nextDay = weekdayOf(date);
    const first = sortedRanges(hours, nextDay)[0];
    if (first) {
      next = offset >= 7 ? { dayOffset: offset, day: nextDay, time: first.open, date } : { dayOffset: offset, day: nextDay, time: first.open };
      break;
    }
  }
  return closedToday
    ? { state: 'closed', next, closure: { label: closedToday.label?.trim() || null, to: closedToday.to } }
    : { state: 'closed', next };
}

/** Closures that end today or later, in date order. */
export function upcomingClosures(hours: Pick<OpeningHours, 'closures'>, today: string): Closure[] {
  return [...(hours.closures ?? [])].filter((c) => c.to >= today).sort((a, b) => a.from.localeCompare(b.from));
}

export function hasAnyOpening(hours: OpeningHours | null | undefined): hours is OpeningHours {
  return Boolean(hours && DAY_KEYS.some((day) => (hours.days[day] ?? []).length > 0));
}

/** Jours consécutifs aux horaires identiques regroupés : « Lun – Sam » / « Dim ». */
export function weekRows(hours: OpeningHours): Array<{ from: DayKey; to: DayKey; ranges: TimeRange[] }> {
  const rows: Array<{ from: DayKey; to: DayKey; ranges: TimeRange[] }> = [];
  for (const day of DAY_KEYS) {
    const ranges = sortedRanges(hours, day);
    const last = rows[rows.length - 1];
    if (last && JSON.stringify(last.ranges) === JSON.stringify(ranges)) last.to = day;
    else rows.push({ from: day, to: day, ranges });
  }
  return rows;
}

type Lang = 'fr' | 'it';

export const DAY_LABELS: Record<Lang, Record<DayKey, string>> = {
  fr: { mon: 'Lun', tue: 'Mar', wed: 'Mer', thu: 'Jeu', fri: 'Ven', sat: 'Sam', sun: 'Dim' },
  it: { mon: 'Lun', tue: 'Mar', wed: 'Mer', thu: 'Gio', fri: 'Ven', sat: 'Sab', sun: 'Dom' },
};

export const DAY_NAMES: Record<Lang, Record<DayKey, string>> = {
  fr: { mon: 'lundi', tue: 'mardi', wed: 'mercredi', thu: 'jeudi', fri: 'vendredi', sat: 'samedi', sun: 'dimanche' },
  it: { mon: 'lunedì', tue: 'martedì', wed: 'mercoledì', thu: 'giovedì', fri: 'venerdì', sat: 'sabato', sun: 'domenica' },
};

/** « 9h00 » (fr) / « 9:00 » (it). */
export function formatTime(time: string, lang: Lang): string {
  const [h, m] = time.split(':');
  const hour = String(Number(h));
  return lang === 'fr' ? `${hour}h${m}` : `${hour}:${m}`;
}

/** « 25 déc. » (fr) / « 25 dic » (it). */
export function formatShortDate(date: string, lang: Lang): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-FR' : 'it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/** Phrase de statut : « Ouvert · jusqu'à 19h00 », « Fermé · ouvre demain à 9h00 ». */
export function statusLabel(status: OpeningStatus, lang: Lang): { title: string; detail: string | null } {
  const fr = lang === 'fr';
  if (status.state === 'open') {
    return { title: fr ? 'Ouvert maintenant' : 'Aperto ora', detail: `${fr ? 'jusqu’à' : 'fino alle'} ${formatTime(status.closesAt, lang)}` };
  }
  const title = status.closure ? (fr ? 'Fermé exceptionnellement' : 'Chiuso eccezionalmente') : (fr ? 'Fermé' : 'Chiuso');
  const reason = status.closure?.label ?? null;
  if (!status.next) return { title, detail: reason };
  const time = formatTime(status.next.time, lang);
  const verb = status.closure ? (fr ? 'réouvre' : 'riapre') : (fr ? 'ouvre' : 'apre');
  const when = status.next.dayOffset === 0
    ? (fr ? `${verb} à ${time}` : `${verb} alle ${time}`)
    : status.next.dayOffset === 1
      ? (fr ? `${verb} demain à ${time}` : `${verb} domani alle ${time}`)
      : status.next.date
        ? (fr ? `${verb} le ${formatShortDate(status.next.date, lang)} à ${time}` : `${verb} il ${formatShortDate(status.next.date, lang)} alle ${time}`)
        : (fr ? `${verb} ${DAY_NAMES.fr[status.next.day]} à ${time}` : `${verb} ${DAY_NAMES.it[status.next.day]} alle ${time}`);
  return { title, detail: reason ? `${reason} · ${when}` : when };
}

/** Compact hour for texts: « 9h », « 9h30 » (fr) / « 9 », « 9:30 » (it). */
function compactTime(time: string, lang: Lang): string {
  const [h, m] = time.split(':');
  const hour = String(Number(h));
  if (m === '00') return lang === 'fr' ? `${hour}h` : hour;
  return lang === 'fr' ? `${hour}h${m}` : `${hour}:${m}`;
}

/**
 * Text version of the week for pickup e-mails, Nala, WhatsApp and the poster
 * (`tenants.click_collect_hours` / `_it`), generated from the grid on save so
 * it never contradicts the card: « Lun–Sam : 9h–20h · Dim : 10h–19h ».
 */
export function openingHoursText(hours: OpeningHours, lang: Lang): string {
  const fr = lang === 'fr';
  const rows = weekRows(hours).map((row) => {
    const days = row.from === row.to ? DAY_LABELS[lang][row.from] : `${DAY_LABELS[lang][row.from]}–${DAY_LABELS[lang][row.to]}`;
    const value = row.ranges.length === 0
      ? (fr ? 'fermé' : 'chiuso')
      : row.ranges.map((r) => `${compactTime(r.open, lang)}–${compactTime(r.close, lang)}`).join(fr ? ' et ' : ' e ');
    return `${days}${fr ? ' : ' : ': '}${value}`;
  });
  const note = hours.note?.[lang]?.trim();
  return [rows.join(' · '), note].filter(Boolean).join('. ');
}
