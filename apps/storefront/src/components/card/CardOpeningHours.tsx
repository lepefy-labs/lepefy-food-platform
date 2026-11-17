'use client';

import { useEffect, useState } from 'react';
import { IconClock } from '@tabler/icons-react';
import {
  DAY_LABELS, addDays, formatShortDate, formatTime, localDate, localNow, openingStatus, statusLabel, upcomingClosures, weekRows,
  type Closure, type DayKey, type OpeningHours, type OpeningStatus,
} from '@/lib/card/openingHours';

type Lang = 'fr' | 'it';

const COPY = {
  fr: { title: 'Horaires', closed: 'Fermé', closures: 'Fermetures à venir' },
  it: { title: 'Orari', closed: 'Chiuso', closures: 'Chiusure in arrivo' },
} as const;

/**
 * Horaires structurés de /card. Le statut dépend de l'heure : il est calculé
 * dans le navigateur après le montage (la page est mise en cache ISR) dans le
 * fuseau du commerce, puis rafraîchi chaque minute.
 */
export function CardOpeningHours({ hours, lang, primaryColor }: { hours: OpeningHours; lang: Lang; primaryColor: string }) {
  const t = COPY[lang];
  const [status, setStatus] = useState<OpeningStatus | null>(null);
  const [today, setToday] = useState<DayKey | null>(null);
  const [soon, setSoon] = useState<Closure[]>([]);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setStatus(openingStatus(hours, now));
      setToday(localNow(now, hours.timezone).day);
      // Closures starting within 30 days (today's one is in the status pill).
      const date = localDate(now, hours.timezone);
      setSoon(upcomingClosures(hours, date).filter((c) => c.from > date && c.from <= addDays(date, 30)));
    };
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [hours]);

  const label = status ? statusLabel(status, lang) : null;
  const open = status?.state === 'open';
  const dayRange = (from: DayKey, to: DayKey) => (from === to ? DAY_LABELS[lang][from] : `${DAY_LABELS[lang][from]} – ${DAY_LABELS[lang][to]}`);

  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gray-50" style={{ color: primaryColor }} aria-hidden><IconClock size={19} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-xs font-bold uppercase tracking-wide text-gray-600">{t.title}</span>
          {label && (
            <span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${open ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
              <span aria-hidden className={`h-2 w-2 rounded-full ${open ? 'bg-emerald-600' : 'bg-red-600'}`} />
              {label.title}{label.detail ? ` · ${label.detail}` : ''}
            </span>
          )}
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {weekRows(hours).map((row) => {
            const isToday = today !== null && weekRowContains(row.from, row.to, today);
            return (
              <div key={row.from} className="contents">
                <dt className={isToday ? 'font-bold text-gray-900' : 'text-gray-700'}>{dayRange(row.from, row.to)}</dt>
                <dd className={`text-right tabular-nums ${isToday ? 'font-bold text-gray-900' : 'text-gray-800'}`}>
                  {row.ranges.length === 0 ? t.closed : row.ranges.map((range) => <span key={range.open} className="block whitespace-nowrap">{formatTime(range.open, lang)} – {formatTime(range.close, lang)}</span>)}
                </dd>
              </div>
            );
          })}
        </dl>
        {soon.length > 0 && (
          <p className="mt-2 text-xs leading-5 text-gray-700">
            <span className="font-bold">{t.closures} :</span>{' '}
            {soon.map((c) => `${c.from === c.to ? formatShortDate(c.from, lang) : `${formatShortDate(c.from, lang)} – ${formatShortDate(c.to, lang)}`}${c.label ? ` (${c.label})` : ''}`).join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
}

const ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function weekRowContains(from: DayKey, to: DayKey, day: DayKey): boolean {
  const index = ORDER.indexOf(day);
  return index >= ORDER.indexOf(from) && index <= ORDER.indexOf(to);
}
