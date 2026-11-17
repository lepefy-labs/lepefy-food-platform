import { test, expect } from '@playwright/test';
import {
  emptyWeek, openingHoursSchema, openingHoursText, openingStatus, statusLabel, upcomingClosures, type OpeningHours,
} from '../../src/lib/card/openingHours';

// Mon–Sat 9–20, Sun 10–19, Europe/Rome (UTC+1 in winter).
function chloe(extra: Partial<OpeningHours> = {}): OpeningHours {
  const days = emptyWeek();
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const) days[d] = [{ open: '09:00', close: '20:00' }];
  days.sun = [{ open: '10:00', close: '19:00' }];
  return { timezone: 'Europe/Rome', days, ...extra };
}
const at = (iso: string) => new Date(iso);

test.describe('texte généré pour e-mails, Nala et affiche', () => {
  test('même texte que celui saisi à la main aujourd’hui', () => {
    expect(openingHoursText(chloe(), 'fr')).toBe('Lun–Sam : 9h–20h · Dim : 10h–19h');
    expect(openingHoursText(chloe(), 'it')).toBe('Lun–Sab: 9–20 · Dom: 10–19');
  });
  test('pause déjeuner, minutes, jour fermé', () => {
    const h = chloe();
    h.days.mon = [{ open: '09:30', close: '13:00' }, { open: '15:00', close: '19:30' }];
    h.days.sun = [];
    expect(openingHoursText(h, 'fr')).toBe('Lun : 9h30–13h et 15h–19h30 · Mar–Sam : 9h–20h · Dim : fermé');
    expect(openingHoursText(h, 'it')).toBe('Lun: 9:30–13 e 15–19:30 · Mar–Sab: 9–20 · Dom: chiuso');
  });
  test('précision ajoutée par langue', () => {
    const h = chloe({ note: { fr: 'Fermé les jours fériés', it: 'Chiuso nei giorni festivi' } });
    expect(openingHoursText(h, 'fr')).toBe('Lun–Sam : 9h–20h · Dim : 10h–19h. Fermé les jours fériés');
    expect(openingHoursText(h, 'it')).toBe('Lun–Sab: 9–20 · Dom: 10–19. Chiuso nei giorni festivi');
  });
});

test.describe('fermetures exceptionnelles', () => {
  const xmas = chloe({ closures: [{ from: '2026-12-25', to: '2026-12-26', label: 'Noël' }] });

  test('le jour fermé : statut exceptionnel et réouverture', () => {
    // Fri 25 Dec 2026, 11:00 in Rome.
    const s = openingStatus(xmas, at('2026-12-25T10:00:00Z'));
    expect(s).toEqual({ state: 'closed', next: { dayOffset: 2, day: 'sun', time: '10:00' }, closure: { label: 'Noël', to: '2026-12-26' } });
    expect(statusLabel(s, 'fr')).toEqual({ title: 'Fermé exceptionnellement', detail: 'Noël · réouvre dimanche à 10h00' });
    expect(statusLabel(s, 'it').title).toBe('Chiuso eccezionalmente');
  });
  test('la veille au soir : la réouverture saute les jours fermés', () => {
    const s = openingStatus(xmas, at('2026-12-24T20:00:00Z'));
    expect(s).toEqual({ state: 'closed', next: { dayOffset: 3, day: 'sun', time: '10:00' } });
  });
  test('congés longs : date de réouverture', () => {
    const h = chloe({ closures: [{ from: '2026-08-10', to: '2026-08-23', label: 'Congés' }] });
    const s = openingStatus(h, at('2026-08-12T10:00:00Z'));
    expect(s.state).toBe('closed');
    expect(statusLabel(s, 'fr')).toEqual({ title: 'Fermé exceptionnellement', detail: 'Congés · réouvre le 24 août à 9h00' });
  });
  test('sans fermeture, la forme du statut ne change pas', () => {
    expect(openingStatus(chloe(), at('2026-12-21T10:00:00Z'))).toEqual({ state: 'open', closesAt: '20:00' });
  });
  test('prochaines fermetures triées, passées retirées', () => {
    const h = chloe({ closures: [{ from: '2026-12-25', to: '2026-12-26' }, { from: '2026-08-10', to: '2026-08-23' }, { from: '2026-11-01', to: '2026-11-01' }] });
    expect(upcomingClosures(h, '2026-11-17').map((c) => c.from)).toEqual(['2026-12-25']);
  });
  test('validation : dates, ordre, sans fermetures (données existantes)', () => {
    expect(openingHoursSchema.safeParse(chloe()).success).toBe(true);
    expect(openingHoursSchema.safeParse(chloe({ closures: [{ from: '2026-12-26', to: '2026-12-25' }] })).success).toBe(false);
    expect(openingHoursSchema.safeParse(chloe({ closures: [{ from: '2026-13-01', to: '2026-13-02' }] })).success).toBe(false);
  });
});
