import { z } from 'zod';

/**
 * Horaires d'ouverture structurés du commerce (carte digitale), stockés dans
 * `tenant_feature_settings('digital_card').config.opening_hours` — aucune
 * migration. Les horaires texte libre (`tenants.click_collect_hours*`) restent
 * la source des confirmations de retrait, de Nala et du portail commande.
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

export const openingHoursSchema = z.object({
  timezone: z.enum(SUPPORTED_TIMEZONES),
  days: z.object(Object.fromEntries(DAY_KEYS.map((day) => [day, daySchema])) as Record<DayKey, typeof daySchema>).strict(),
}).strict();

export type TimeRange = z.infer<typeof rangeSchema>;
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
  | { state: 'closed'; next: { dayOffset: number; day: DayKey; time: string } | null };

export function openingStatus(hours: OpeningHours, now: Date): OpeningStatus {
  const { day, minute } = localNow(now, hours.timezone);
  const today = sortedRanges(hours, day);
  const current = today.find((range) => minute >= minutes(range.open) && minute < minutes(range.close));
  if (current) return { state: 'open', closesAt: current.close };
  const laterToday = today.find((range) => minutes(range.open) > minute);
  if (laterToday) return { state: 'closed', next: { dayOffset: 0, day, time: laterToday.open } };
  const start = DAY_KEYS.indexOf(day);
  for (let offset = 1; offset <= 7; offset += 1) {
    const next = DAY_KEYS[(start + offset) % 7]!;
    const first = sortedRanges(hours, next)[0];
    if (first) return { state: 'closed', next: { dayOffset: offset, day: next, time: first.open } };
  }
  return { state: 'closed', next: null };
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

/** Phrase de statut : « Ouvert · jusqu'à 19h00 », « Fermé · ouvre demain à 9h00 ». */
export function statusLabel(status: OpeningStatus, lang: Lang): { title: string; detail: string | null } {
  const fr = lang === 'fr';
  if (status.state === 'open') {
    return { title: fr ? 'Ouvert maintenant' : 'Aperto ora', detail: `${fr ? 'jusqu’à' : 'fino alle'} ${formatTime(status.closesAt, lang)}` };
  }
  if (!status.next) return { title: fr ? 'Fermé' : 'Chiuso', detail: null };
  const time = formatTime(status.next.time, lang);
  const when = status.next.dayOffset === 0
    ? (fr ? `ouvre à ${time}` : `apre alle ${time}`)
    : status.next.dayOffset === 1
      ? (fr ? `ouvre demain à ${time}` : `apre domani alle ${time}`)
      : (fr ? `ouvre ${DAY_NAMES.fr[status.next.day]} à ${time}` : `apre ${DAY_NAMES.it[status.next.day]} alle ${time}`);
  return { title: fr ? 'Fermé' : 'Chiuso', detail: when };
}
