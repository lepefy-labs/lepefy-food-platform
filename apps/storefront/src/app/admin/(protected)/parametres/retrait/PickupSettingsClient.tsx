'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  IconCalendarOff, IconClockHour4, IconCopy, IconExternalLink, IconLifebuoy, IconMapPin, IconPlus, IconTrash, IconWand,
} from '@tabler/icons-react';
import Button, { IconButton } from '../../../_components/ui/Button';
import Badge from '../../../_components/ui/Badge';
import Menu, { MenuButton } from '../../../_components/ui/Menu';
import { Input, Select, Textarea } from '../../../_components/ui/Form';
import InlineAlert, { ErrorText } from '../../../_components/ui/InlineAlert';
import { useUnsavedChangesGuard } from '../../../_components/ui/ConfirmDialog';
import { useAdminToast } from '../../../_components/ui/Toaster';
import { useSupport } from '../../../_components/support/SupportProvider';
import { cn } from '@/lib/utils/cn';
import {
  DAY_KEYS, MAX_CLOSURES, MAX_NOTE_LENGTH, MAX_RANGES_PER_DAY, SUPPORTED_TIMEZONES, emptyWeek, formatShortDate, localDate,
  openingHoursSchema, openingHoursText, openingStatus, statusLabel,
  type Closure, type DayKey, type OpeningHours, type TimeRange,
} from '@/lib/card/openingHours';

const DAY_NAMES: Record<DayKey, string> = {
  mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi', fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche',
};

const TIMEZONE_LABELS: Record<OpeningHours['timezone'], string> = {
  'Europe/Rome': 'Italie (Rome)', 'Europe/Paris': 'France (Paris)', 'Europe/Brussels': 'Belgique (Bruxelles)',
  'Europe/Madrid': 'Espagne (Madrid)', 'Europe/Berlin': 'Allemagne (Berlin)', 'Europe/Zurich': 'Suisse (Zurich)',
  'Europe/Lisbon': 'Portugal (Lisbonne)', 'Europe/London': 'Royaume-Uni (Londres)', 'Africa/Douala': 'Cameroun (Douala)',
  'Africa/Abidjan': 'Côte d’Ivoire (Abidjan)', 'Africa/Dakar': 'Sénégal (Dakar)', 'Africa/Lagos': 'Nigeria (Lagos)',
  'Africa/Kinshasa': 'RD Congo (Kinshasa)',
};

const COPY_TARGETS: Array<{ label: string; days: DayKey[] }> = [
  { label: 'Du lundi au vendredi', days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
  { label: 'Du lundi au samedi', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] },
  { label: 'Tous les jours', days: [...DAY_KEYS] },
  { label: 'Samedi et dimanche', days: ['sat', 'sun'] },
];

function starterWeek(timezone: OpeningHours['timezone']): OpeningHours {
  const days = emptyWeek();
  for (const day of DAY_KEYS) if (day !== 'sun') days[day] = [{ open: '09:00', close: '19:00' }];
  return { timezone, days };
}

/** Google Maps search link for an address (accepted by the tenant API: www.google.com). */
export function mapsLinkForAddress(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.replace(/\s+/g, ' ').trim())}`;
}

/** Hours as saved: empty notes removed, past closures dropped, closures sorted. */
function forSave(hours: OpeningHours, today: string): OpeningHours {
  const closures = (hours.closures ?? []).filter((c) => c.to >= today).sort((a, b) => a.from.localeCompare(b.from))
    .map((c) => (c.label?.trim() ? { ...c, label: c.label.trim() } : { from: c.from, to: c.to }));
  const fr = hours.note?.fr?.trim();
  const it = hours.note?.it?.trim();
  const note = fr || it ? { ...(fr ? { fr } : {}), ...(it ? { it } : {}) } : undefined;
  return { timezone: hours.timezone, days: hours.days, ...(closures.length ? { closures } : {}), ...(note ? { note } : {}) };
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json() as { error?: unknown };
    return typeof body.error === 'string' && body.error ? body.error : fallback;
  } catch {
    return fallback;
  }
}

interface PickupSettingsClientProps {
  initialPoint: { address: string; mapsUrl: string };
  initialHours: OpeningHours | null;
  currentHoursText: { fr: string; it: string };
  defaultTimezone: OpeningHours['timezone'];
  clickCollectEnabled: boolean;
  readOnly: boolean;
}

export function PickupSettingsClient({ initialPoint, initialHours, currentHoursText, defaultTimezone, clickCollectEnabled, readOnly }: PickupSettingsClientProps) {
  const toast = useAdminToast();
  const support = useSupport();
  const [point, setPoint] = useState(initialPoint);
  const [savedPoint, setSavedPoint] = useState(initialPoint);
  const [hours, setHours] = useState<OpeningHours | null>(initialHours);
  const [savedHours, setSavedHours] = useState<OpeningHours | null>(initialHours);
  const [savedText, setSavedText] = useState(currentHoursText);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [newClosure, setNewClosure] = useState<{ from: string; to: string; label: string }>({ from: '', to: '', label: '' });
  useEffect(() => { setNow(new Date()); const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);

  const today = now && hours ? localDate(now, hours.timezone) : null;
  const pointDirty = point.address.trim() !== savedPoint.address.trim() || point.mapsUrl.trim() !== savedPoint.mapsUrl.trim();
  const hoursDirty = JSON.stringify(hours) !== JSON.stringify(savedHours);
  const dirty = pointDirty || hoursDirty;
  const guard = useUnsavedChangesGuard(dirty, 'Vos modifications du point de retrait et des horaires seront perdues.');

  const validation = useMemo(() => (hours ? openingHoursSchema.safeParse(hours) : null), [hours]);
  const dayErrors = useMemo(() => {
    const errors: Partial<Record<DayKey, string>> = {};
    if (validation && !validation.success) {
      for (const issue of validation.error.issues) {
        const day = issue.path[1] as DayKey | undefined;
        if (issue.path[0] === 'days' && day && !errors[day]) errors[day] = issue.message;
      }
    }
    return errors;
  }, [validation]);
  const preview = hours && validation?.success && now ? statusLabel(openingStatus(validation.data, now), 'fr') : null;
  const generated = hours && validation?.success ? { fr: openingHoursText(validation.data, 'fr'), it: openingHoursText(validation.data, 'it') } : null;
  const mapsInvalid = point.mapsUrl.trim() !== '' && !/^https:\/\//i.test(point.mapsUrl.trim());
  const addressChangedWithoutMaps = point.address.trim() !== savedPoint.address.trim() && point.mapsUrl.trim() === savedPoint.mapsUrl.trim() && point.address.trim() !== '';

  const visibleClosures = (hours?.closures ?? [])
    .map((closure, index) => ({ closure, index }))
    .filter(({ closure }) => !today || closure.to >= today)
    .sort((a, b) => a.closure.from.localeCompare(b.closure.from));
  const pastClosures = (hours?.closures ?? []).length - visibleClosures.length;

  // ---------- Grid edits ----------
  function updateDay(day: DayKey, ranges: TimeRange[]) {
    setHours((current) => (current ? { ...current, days: { ...current.days, [day]: ranges } } : current));
  }
  function copyDay(from: DayKey, targets: DayKey[]) {
    setHours((current) => {
      if (!current) return current;
      const days = { ...current.days };
      for (const day of targets) if (day !== from) days[day] = current.days[from].map((r) => ({ ...r }));
      return { ...current, days };
    });
  }
  function setNote(lang: 'fr' | 'it', value: string) {
    setHours((current) => (current ? { ...current, note: { ...current.note, [lang]: value } } : current));
  }

  // ---------- Closures ----------
  const closureError = (() => {
    if (!newClosure.from) return null;
    const to = newClosure.to || newClosure.from;
    if (to < newClosure.from) return 'La fin doit être le même jour ou après le début.';
    if (today && to < today) return 'Cette période est déjà passée.';
    return null;
  })();
  function addClosure() {
    if (!hours || !newClosure.from || closureError) return;
    const closure: Closure = { from: newClosure.from, to: newClosure.to || newClosure.from, ...(newClosure.label.trim() ? { label: newClosure.label.trim().slice(0, 60) } : {}) };
    setHours({ ...hours, closures: [...(hours.closures ?? []), closure] });
    setNewClosure({ from: '', to: '', label: '' });
  }
  function removeClosure(index: number) {
    if (!hours) return;
    setHours({ ...hours, closures: (hours.closures ?? []).filter((_, i) => i !== index) });
  }

  // ---------- Save ----------
  async function save() {
    if (saving || !dirty) return;
    if (hoursDirty && hours && !validation?.success) { setSaveError('Corrigez les horaires signalés avant d’enregistrer.'); return; }
    if (mapsInvalid) { setSaveError('Le lien Google Maps doit commencer par https://.'); return; }
    setSaving(true);
    setSaveError(null);
    try {
      if (pointDirty) {
        const res = await fetch('/api/admin/tenant', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ click_collect_address: point.address, google_maps_url: point.mapsUrl }),
        }).catch(() => null);
        if (!res?.ok) { setSaveError(res ? await readError(res, 'Le point de retrait n’a pas pu être enregistré.') : 'Connexion impossible. Réessayez.'); return; }
        setSavedPoint({ address: point.address.trim(), mapsUrl: point.mapsUrl.trim() });
      }
      if (hoursDirty && hours && validation?.success && today) {
        const payload = forSave(validation.data, today);
        const res = await fetch('/api/admin/card/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ opening_hours: payload }),
        }).catch(() => null);
        if (!res?.ok) { setSaveError(res ? await readError(res, 'Les horaires n’ont pas pu être enregistrés.') : 'Connexion impossible. Réessayez.'); return; }
        const body = await res.json().catch(() => null) as { hours_text?: { fr: string; it: string } | null } | null;
        setHours(payload);
        setSavedHours(payload);
        if (body?.hours_text) setSavedText(body.hours_text);
      }
      toast.success('Point de retrait et horaires enregistrés', { description: hoursDirty ? 'La carte, les e-mails de retrait et Nala affichent les nouveaux horaires.' : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Summary: click & collect + what the card says now */}
      <section className="grid gap-3 rounded-2xl border border-a-border bg-a-surface p-4 sm:grid-cols-2 sm:p-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-a-text-3">Retrait en boutique (click &amp; collect)</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone={clickCollectEnabled ? 'success' : 'neutral'} dot>{clickCollectEnabled ? 'Proposé au checkout' : 'Non proposé'}</Badge>
          </div>
          <p className="mt-1.5 text-xs leading-5 text-a-text-3">
            Activé ou désactivé par Lepefy pour votre boutique.
            {support.enabled && !support.readOnly ? ' ' : ' Pour le changer, contactez l’assistance.'}
            {support.enabled && !support.readOnly && (
              <button type="button" onClick={() => support.open({ text: `Je souhaite ${clickCollectEnabled ? 'désactiver' : 'activer'} le retrait en boutique (click & collect).` })} className="inline-flex items-center gap-1 font-semibold text-a-brand-fg hover:underline">
                <IconLifebuoy size={13} aria-hidden="true" />Demander un changement
              </button>
            )}
          </p>
        </div>
        <div className="min-w-0 sm:border-l sm:border-a-border sm:pl-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-a-text-3">Sur la carte digitale maintenant</p>
          {preview ? (
            <p className="mt-1.5 text-sm font-semibold text-a-text">
              <span className={cn('mr-1.5 inline-block h-2 w-2 rounded-full align-middle', preview.title.startsWith('Ouvert') ? 'bg-tone-success-solid' : 'bg-tone-danger-solid')} aria-hidden="true" />
              {preview.title}{preview.detail ? <span className="font-normal text-a-text-2"> · {preview.detail}</span> : null}
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-a-text-3">{hours ? 'Corrigez les horaires pour voir l’aperçu.' : 'Pas d’horaires : la carte n’affiche pas « Ouvert / Fermé ».'}</p>
          )}
          {hoursDirty && preview && <p className="mt-1 text-xs text-a-text-3">Aperçu des horaires non enregistrés.</p>}
        </div>
      </section>

      <fieldset disabled={readOnly || saving} className="space-y-5">
        {/* Point de retrait */}
        <section id="point-principal" aria-labelledby="point-title" className="scroll-mt-24 rounded-2xl border border-a-border bg-a-surface">
          <header className="border-b border-a-border px-4 py-4 sm:px-6">
            <h2 id="point-title" className="flex items-center gap-2 text-base font-semibold text-a-text"><IconMapPin size={18} aria-hidden="true" />Point de retrait</h2>
            <p className="mt-1 text-sm text-a-text-3">Adresse affichée au checkout, dans les confirmations de retrait et sur la carte digitale.</p>
          </header>
          <div className="grid gap-5 px-4 py-5 sm:px-6">
            <div>
              <label htmlFor="pickup-address" className="mb-1.5 block text-sm font-semibold text-a-text">Adresse</label>
              <Textarea id="pickup-address" rows={2} autoComplete="street-address" value={point.address} onChange={(e) => setPoint({ ...point, address: e.target.value })} />
            </div>
            <div>
              <label htmlFor="pickup-maps" className="mb-1.5 block text-sm font-semibold text-a-text">Lien Google Maps (itinéraire)</label>
              <Input id="pickup-maps" type="url" inputMode="url" placeholder="https://maps.app.goo.gl/…" value={point.mapsUrl} aria-invalid={mapsInvalid || undefined} onChange={(e) => setPoint({ ...point, mapsUrl: e.target.value })} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {point.mapsUrl.trim() && !mapsInvalid && (
                  <a href={point.mapsUrl.trim()} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-a-border bg-a-surface px-3 text-xs font-semibold text-a-text-2 hover:bg-a-hover hover:text-a-text">
                    Tester l’itinéraire <IconExternalLink size={13} aria-hidden="true" />
                  </a>
                )}
                {point.address.trim() && (
                  <Button variant="ghost" size="sm" onClick={() => setPoint({ ...point, mapsUrl: mapsLinkForAddress(point.address) })}>
                    <IconWand size={14} aria-hidden="true" />Créer le lien depuis l’adresse
                  </Button>
                )}
              </div>
              {addressChangedWithoutMaps && (
                <InlineAlert tone="warning" className="mt-3">Vous avez changé l’adresse : vérifiez que le lien Google Maps mène toujours au bon endroit, ou recréez-le depuis l’adresse.</InlineAlert>
              )}
            </div>
          </div>
        </section>

        {/* Horaires */}
        <section id="horaires-ouverture" aria-labelledby="hours-title" className="scroll-mt-24 rounded-2xl border border-a-border bg-a-surface">
          <header className="border-b border-a-border px-4 py-4 sm:px-6">
            <h2 id="hours-title" className="flex items-center gap-2 text-base font-semibold text-a-text"><IconClockHour4 size={18} aria-hidden="true" />Horaires d’ouverture</h2>
            <p className="mt-1 text-sm text-a-text-3">Une seule saisie : la carte digitale affiche « Ouvert / Fermé », et le texte des e-mails de retrait, de Nala et de WhatsApp est généré à partir de ces horaires.</p>
          </header>

          {!hours ? (
            <div className="space-y-3 px-4 py-5 sm:px-6">
              {(savedText.fr || savedText.it) && <p className="text-sm text-a-text-2">Texte actuel : <span className="font-medium text-a-text">{savedText.fr || savedText.it}</span></p>}
              <Button onClick={() => setHours(starterWeek(defaultTimezone))}><IconClockHour4 size={16} aria-hidden="true" />Saisir les horaires</Button>
            </div>
          ) : (
            <div className="space-y-5 px-4 py-5 sm:px-6">
              <ul className="divide-y divide-a-border rounded-xl border border-a-border">
                {DAY_KEYS.map((day) => {
                  const ranges = hours.days[day];
                  const open = ranges.length > 0;
                  return (
                    <li key={day} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center">
                      <div className="flex items-center justify-between gap-2 sm:justify-start">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={open}
                          aria-label={`${DAY_NAMES[day]} ${open ? 'ouvert' : 'fermé'}`}
                          onClick={() => updateDay(day, open ? [] : [{ open: '09:00', close: '19:00' }])}
                          className="inline-flex min-h-10 items-center gap-2.5 rounded-lg text-sm font-semibold text-a-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus"
                        >
                          <span aria-hidden="true" className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors', open ? 'bg-a-brand' : 'bg-a-border-strong')}>
                            <span className={cn('inline-block h-4 w-4 rounded-full bg-a-surface shadow transition-transform', open ? 'translate-x-[1.125rem]' : 'translate-x-0.5')} />
                          </span>
                          {DAY_NAMES[day]}
                        </button>
                      </div>
                      <div className="min-w-0">
                        {!open ? (
                          <p className="text-sm text-a-text-3">Fermé</p>
                        ) : (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                            {ranges.map((range, index) => (
                              <div key={index} className="flex items-center gap-1.5">
                                <div className="w-[7.25rem]"><Input type="time" aria-label={`${DAY_NAMES[day]}, ouverture ${index + 1}`} value={range.open} onChange={(e) => updateDay(day, ranges.map((r, i) => (i === index ? { ...r, open: e.target.value } : r)))} /></div>
                                <span aria-hidden="true" className="text-a-text-3">–</span>
                                <div className="w-[7.25rem]"><Input type="time" aria-label={`${DAY_NAMES[day]}, fermeture ${index + 1}`} value={range.close} onChange={(e) => updateDay(day, ranges.map((r, i) => (i === index ? { ...r, close: e.target.value } : r)))} /></div>
                                {ranges.length > 1 && <IconButton label={`Supprimer la plage ${index + 1} du ${DAY_NAMES[day].toLowerCase()}`} icon={<IconTrash size={15} />} onClick={() => updateDay(day, ranges.filter((_, i) => i !== index))} />}
                              </div>
                            ))}
                            {ranges.length < MAX_RANGES_PER_DAY && (
                              <IconButton
                                label={`Ajouter une plage le ${DAY_NAMES[day].toLowerCase()} (pause déjeuner)`}
                                icon={<IconPlus size={16} />}
                                onClick={() => {
                                  const last = ranges[ranges.length - 1]!;
                                  // Split the day around lunch when it is one long range.
                                  updateDay(day, ranges.length === 1 && last.open < '12:30' && last.close > '15:00'
                                    ? [{ open: last.open, close: '12:30' }, { open: '15:00', close: last.close }]
                                    : [...ranges, { open: '15:00', close: '19:00' }]);
                                }}
                              />
                            )}
                          </div>
                        )}
                        <ErrorText message={dayErrors[day]} className="mt-1" />
                      </div>
                      <div className="justify-self-start sm:justify-self-end">
                        <Menu label={`Copier les horaires du ${DAY_NAMES[day].toLowerCase()}`} trigger={<span className="inline-flex items-center gap-1.5 text-xs font-semibold"><IconCopy size={14} aria-hidden="true" />Copier vers…</span>} triggerClassName="inline-flex min-h-9 items-center rounded-lg px-2.5 text-a-text-2 hover:bg-a-hover hover:text-a-text">
                          {COPY_TARGETS.map((target) => (
                            <MenuButton key={target.label} onSelect={() => copyDay(day, target.days)}>{target.label}</MenuButton>
                          ))}
                        </Menu>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="hours-note-fr" className="mb-1.5 block text-sm font-semibold text-a-text">Précision (français) <span className="font-normal text-a-text-3">(facultatif)</span></label>
                  <Input id="hours-note-fr" maxLength={MAX_NOTE_LENGTH} placeholder="ex : Fermé les jours fériés" value={hours.note?.fr ?? ''} onChange={(e) => setNote('fr', e.target.value)} />
                </div>
                <div>
                  <label htmlFor="hours-note-it" className="mb-1.5 block text-sm font-semibold text-a-text">Précision (italien) <span className="font-normal text-a-text-3">(facultatif)</span></label>
                  <Input id="hours-note-it" maxLength={MAX_NOTE_LENGTH} placeholder="es: Chiuso nei giorni festivi" value={hours.note?.it ?? ''} onChange={(e) => setNote('it', e.target.value)} />
                </div>
              </div>

              {generated && (
                <div className="rounded-xl border border-a-border bg-a-surface-2 px-3 py-2.5 text-xs leading-5 text-a-text-2">
                  <p className="font-semibold text-a-text">Texte des e-mails de retrait, de Nala et de WhatsApp</p>
                  <p className="mt-1"><span className="font-semibold">FR</span> · {generated.fr}</p>
                  <p><span className="font-semibold">IT</span> · {generated.it}</p>
                  {!savedHours && (savedText.fr || savedText.it) && <p className="mt-1 text-a-text-3">Remplacera le texte saisi à la main : « {savedText.fr || savedText.it} ».</p>}
                </div>
              )}

              <div className="max-w-sm">
                <label htmlFor="hours-timezone" className="mb-1.5 block text-sm font-semibold text-a-text">Fuseau horaire de la boutique</label>
                <Select id="hours-timezone" value={hours.timezone} onChange={(e) => setHours({ ...hours, timezone: e.target.value as OpeningHours['timezone'] })}>
                  {SUPPORTED_TIMEZONES.map((zone) => <option key={zone} value={zone}>{TIMEZONE_LABELS[zone]}</option>)}
                </Select>
                <p className="mt-1.5 text-xs leading-5 text-a-text-3">« Ouvert / Fermé » est calculé à l’heure de la boutique, quel que soit le pays du client.</p>
              </div>
            </div>
          )}
        </section>

        {/* Fermetures exceptionnelles */}
        {hours && (
          <section id="fermetures" aria-labelledby="closures-title" className="scroll-mt-24 rounded-2xl border border-a-border bg-a-surface">
            <header className="border-b border-a-border px-4 py-4 sm:px-6">
              <h2 id="closures-title" className="flex items-center gap-2 text-base font-semibold text-a-text"><IconCalendarOff size={18} aria-hidden="true" />Fermetures exceptionnelles</h2>
              <p className="mt-1 text-sm text-a-text-3">Jours fériés, congés, inventaire : ces jours-là la carte affiche « Fermé exceptionnellement » et la date de réouverture. Les fermetures des 30 prochains jours y sont annoncées.</p>
            </header>
            <div className="space-y-4 px-4 py-5 sm:px-6">
              {visibleClosures.length === 0 ? (
                <p className="text-sm text-a-text-3">Aucune fermeture prévue.</p>
              ) : (
                <ul className="divide-y divide-a-border rounded-xl border border-a-border">
                  {visibleClosures.map(({ closure, index }) => (
                    <li key={`${closure.from}-${index}`} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="font-semibold text-a-text">
                          {closure.from === closure.to ? formatShortDate(closure.from, 'fr') : `Du ${formatShortDate(closure.from, 'fr')} au ${formatShortDate(closure.to, 'fr')}`}
                        </span>
                        {closure.label && <span className="text-a-text-2"> · {closure.label}</span>}
                        {today && closure.from <= today && <Badge tone="warning" className="ml-2">En cours</Badge>}
                      </span>
                      <IconButton label={`Retirer la fermeture du ${formatShortDate(closure.from, 'fr')}`} icon={<IconTrash size={15} />} onClick={() => removeClosure(index)} />
                    </li>
                  ))}
                </ul>
              )}
              {pastClosures > 0 && <p className="text-xs text-a-text-3">{pastClosures === 1 ? '1 fermeture passée sera retirée' : `${pastClosures} fermetures passées seront retirées`} à l’enregistrement.</p>}

              {(hours.closures ?? []).length < MAX_CLOSURES && (
                <div className="grid gap-3 rounded-xl border border-dashed border-a-border-strong p-3 sm:grid-cols-[10rem_10rem_minmax(0,1fr)_auto] sm:items-end">
                  <div>
                    <label htmlFor="closure-from" className="mb-1.5 block text-xs font-semibold text-a-text">Du</label>
                    <Input id="closure-from" type="date" min={today ?? undefined} value={newClosure.from} onChange={(e) => setNewClosure({ ...newClosure, from: e.target.value, to: newClosure.to && newClosure.to >= e.target.value ? newClosure.to : e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="closure-to" className="mb-1.5 block text-xs font-semibold text-a-text">Au (inclus)</label>
                    <Input id="closure-to" type="date" min={newClosure.from || today || undefined} value={newClosure.to} onChange={(e) => setNewClosure({ ...newClosure, to: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="closure-label" className="mb-1.5 block text-xs font-semibold text-a-text">Motif affiché <span className="font-normal text-a-text-3">(facultatif)</span></label>
                    <Input id="closure-label" maxLength={60} placeholder="ex : Noël, Congés d’été" value={newClosure.label} onChange={(e) => setNewClosure({ ...newClosure, label: e.target.value })} />
                  </div>
                  <Button variant="secondary" onClick={addClosure} disabled={!newClosure.from || Boolean(closureError)}><IconPlus size={16} aria-hidden="true" />Ajouter</Button>
                  <ErrorText message={closureError} className="sm:col-span-4" />
                </div>
              )}
            </div>
          </section>
        )}
      </fieldset>

      {/* One save for the whole page */}
      {!readOnly && (
        <div className={cn('sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-a-border bg-a-surface px-4 py-3 shadow-lg md:bottom-4', !dirty && 'shadow-none')}>
          <ErrorText message={saveError} className="mr-auto" />
          {dirty && !saveError && <span className="mr-auto text-xs font-medium text-tone-warning-fg">Modifications non enregistrées</span>}
          {!dirty && !saveError && <span className="mr-auto text-xs text-a-text-3">Tout est enregistré.</span>}
          {dirty && <Button variant="ghost" onClick={() => { setPoint(savedPoint); setHours(savedHours); setSaveError(null); }} disabled={saving}>Annuler les modifications</Button>}
          <Button onClick={() => { void save(); }} loading={saving} disabled={!dirty}>Enregistrer</Button>
        </div>
      )}
      {guard}
    </div>
  );
}
