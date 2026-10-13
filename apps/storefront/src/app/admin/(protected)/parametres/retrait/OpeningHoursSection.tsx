'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconClockHour4, IconCopy, IconPlus, IconTrash } from '@tabler/icons-react';
import Button, { IconButton } from '../../../_components/ui/Button';
import Badge from '../../../_components/ui/Badge';
import { Panel } from '../../../_components/ui/Panel';
import { FormField, Input, Select } from '../../../_components/ui/Form';
import InlineAlert, { ErrorText } from '../../../_components/ui/InlineAlert';
import { useConfirm, useUnsavedChangesGuard } from '../../../_components/ui/ConfirmDialog';
import { useAdminMutation } from '../../../_components/ui/useAdminMutation';
import {
  DAY_KEYS, MAX_RANGES_PER_DAY, SUPPORTED_TIMEZONES, emptyWeek, openingHoursSchema, openingStatus, statusLabel,
  type DayKey, type OpeningHours,
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

function starterWeek(timezone: OpeningHours['timezone']): OpeningHours {
  const days = emptyWeek();
  for (const day of DAY_KEYS) if (day !== 'sun') days[day] = [{ open: '09:00', close: '19:00' }];
  return { timezone, days };
}

/**
 * Horaires structurés de la carte digitale (statut « Ouvert maintenant / Fermé »).
 * Stockés dans tenant_feature_settings('digital_card') ; les horaires texte du
 * point de retrait restent la référence des confirmations et de Nala.
 */
export function OpeningHoursSection({ initial, defaultTimezone, readOnly = false }: { initial: OpeningHours | null; defaultTimezone: OpeningHours['timezone']; readOnly?: boolean }) {
  const save = useAdminMutation();
  const [ask, confirmDialog] = useConfirm();
  const [hours, setHours] = useState<OpeningHours | null>(initial);
  const [saved, setSaved] = useState<OpeningHours | null>(initial);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);

  const dirty = JSON.stringify(hours) !== JSON.stringify(saved);
  const guard = useUnsavedChangesGuard(dirty);
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

  function updateDay(day: DayKey, ranges: OpeningHours['days'][DayKey]) {
    setHours((current) => (current ? { ...current, days: { ...current.days, [day]: ranges } } : current));
  }

  function copyMondayToWeekdays() {
    setHours((current) => {
      if (!current) return current;
      const days = { ...current.days };
      for (const day of ['tue', 'wed', 'thu', 'fri'] as DayKey[]) days[day] = current.days.mon.map((range) => ({ ...range }));
      return { ...current, days };
    });
  }

  async function handleSave() {
    if (!hours || !validation?.success) return;
    const result = await save.run('/api/admin/card/settings', { method: 'PATCH', body: { opening_hours: validation.data }, successMessage: 'Horaires enregistrés' });
    if (result) setSaved(validation.data);
  }

  async function handleRemove() {
    const confirmed = await ask({
      title: 'Supprimer les horaires détaillés ?',
      description: 'La carte digitale n’affichera plus « Ouvert maintenant » ni « Fermé » : elle reprendra les horaires texte ci-dessus.',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!confirmed) return;
    const result = await save.run('/api/admin/card/settings', { method: 'PATCH', body: { opening_hours: null }, successMessage: 'Horaires détaillés supprimés' });
    if (result) { setHours(null); setSaved(null); }
  }

  return (
    <Panel
      id="horaires-ouverture"
      title="Horaires d’ouverture détaillés"
      description="Affichent « Ouvert maintenant » ou « Fermé · ouvre demain à 9h00 » sur la carte digitale, avec le tableau de la semaine."
      actions={saved ? <Badge tone="success" dot>Affichés sur la carte</Badge> : <Badge tone="neutral" dot>Non configurés</Badge>}
    >
      {!hours ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-a-text-2">Sans horaires détaillés, la carte affiche les horaires texte saisis ci-dessus, sans statut d’ouverture.</p>
          <Button onClick={() => setHours(starterWeek(defaultTimezone))} disabled={readOnly}><IconClockHour4 size={16} aria-hidden="true" />Configurer les horaires</Button>
        </div>
      ) : (
        <fieldset disabled={readOnly} className="space-y-4">
          <ul className="divide-y divide-a-border rounded-lg border border-a-border">
            {DAY_KEYS.map((day) => {
              const ranges = hours.days[day];
              const open = ranges.length > 0;
              return (
                <li key={day} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:gap-4">
                  <label className="flex min-h-10 w-40 shrink-0 items-center gap-2.5 text-sm font-semibold text-a-text">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0"
                      checked={open}
                      onChange={(event) => updateDay(day, event.target.checked ? [{ open: '09:00', close: '19:00' }] : [])}
                    />
                    {DAY_NAMES[day]}
                  </label>
                  <div className="min-w-0 flex-1">
                    {!open ? (
                      <p className="flex min-h-10 items-center text-sm text-a-text-3">Fermé</p>
                    ) : (
                      <div className="space-y-2">
                        {ranges.map((range, index) => (
                          <div key={index} className="flex flex-wrap items-center gap-2">
                            <div className="w-[8.5rem] shrink-0"><Input
                              type="time"
                              aria-label={`${DAY_NAMES[day]} — ouverture ${index + 1}`}
                              value={range.open}
                              onChange={(event) => updateDay(day, ranges.map((r, i) => (i === index ? { ...r, open: event.target.value } : r)))}
                            /></div>
                            <span aria-hidden="true" className="text-a-text-3">–</span>
                            <div className="w-[8.5rem] shrink-0"><Input
                              type="time"
                              aria-label={`${DAY_NAMES[day]} — fermeture ${index + 1}`}
                              value={range.close}
                              onChange={(event) => updateDay(day, ranges.map((r, i) => (i === index ? { ...r, close: event.target.value } : r)))}
                            /></div>
                            {ranges.length > 1 && (
                              <IconButton label={`Supprimer la plage ${index + 1} du ${DAY_NAMES[day].toLowerCase()}`} icon={<IconTrash size={16} />} onClick={() => updateDay(day, ranges.filter((_, i) => i !== index))} />
                            )}
                          </div>
                        ))}
                        {ranges.length < MAX_RANGES_PER_DAY && (
                          <Button variant="ghost" size="sm" onClick={() => updateDay(day, [...ranges, { open: '15:00', close: '19:00' }])}>
                            <IconPlus size={14} aria-hidden="true" />Ajouter une plage (pause déjeuner)
                          </Button>
                        )}
                        <ErrorText message={dayErrors[day]} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Fuseau horaire de la boutique" hint="Le statut est calculé à l’heure de la boutique, quel que soit le pays du client.">
              <Select value={hours.timezone} onChange={(event) => setHours({ ...hours, timezone: event.target.value as OpeningHours['timezone'] })}>
                {SUPPORTED_TIMEZONES.map((zone) => <option key={zone} value={zone}>{TIMEZONE_LABELS[zone]}</option>)}
              </Select>
            </FormField>
            <div className="flex items-end">
              <Button variant="secondary" onClick={copyMondayToWeekdays}><IconCopy size={16} aria-hidden="true" />Copier le lundi du mardi au vendredi</Button>
            </div>
          </div>

          {preview && (
            <InlineAlert tone="info" title="Aperçu sur la carte maintenant">
              {preview.title}{preview.detail ? ` · ${preview.detail}` : ''}
            </InlineAlert>
          )}
          <ErrorText message={save.error} />

          <div className="flex flex-wrap justify-between gap-2 border-t border-a-border pt-4">
            {saved ? (
              <Button variant="ghost" onClick={handleRemove} disabled={save.pending}><IconTrash size={16} aria-hidden="true" />Supprimer les horaires détaillés</Button>
            ) : (
              <Button variant="ghost" onClick={() => setHours(null)} disabled={save.pending}>Annuler</Button>
            )}
            <Button onClick={handleSave} loading={save.pending} disabled={!dirty || !validation?.success}>Enregistrer les horaires</Button>
          </div>
        </fieldset>
      )}
      {confirmDialog}
      {guard}
    </Panel>
  );
}
