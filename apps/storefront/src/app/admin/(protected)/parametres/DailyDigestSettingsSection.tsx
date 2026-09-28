'use client';

import Link from 'next/link';
import { useState } from 'react';
import { IconClockPlay } from '@tabler/icons-react';
import Button from '../../_components/ui/Button';
import type { DailyDigestConfig } from '@/lib/notifications/dailyDigestConfig';
import { SettingsFeedback, SettingsIconTile, SettingsStatusBadge, SETTINGS_HINT_CLS, SETTINGS_INPUT_CLS, SETTINGS_LABEL_CLS } from './_components/SettingsUi';
import { useSettingsFeedback } from './_components/useSettingsFeedback';

export interface DailyDigestSettingsInitial {
  status: 'missing' | 'ok' | 'invalid';
  enabled: boolean;
  config: DailyDigestConfig;
}

type Form = { enabled: boolean } & Omit<DailyDigestConfig, 'version'>;
type HoursKey = 'prepare_hours' | 'pickup_hours' | 'payment_verification_hours' | 'tracking_stale_hours';

const HOURS_FIELDS: ReadonlyArray<{ key: HoursKey; label: string; hint: string; min: number }> = [
  { key: 'prepare_hours', label: 'Commandes en préparation', hint: 'Préparation en retard après', min: 1 },
  { key: 'pickup_hours', label: 'Retrait en retard', hint: 'Commande non retirée après', min: 1 },
  { key: 'payment_verification_hours', label: 'Paiement à vérifier', hint: 'Paiement externe en attente après', min: 1 },
  { key: 'tracking_stale_hours', label: 'Tracking sans mouvement', hint: 'Suivi transporteur inactif après', min: 24 },
];

interface Props {
  initial: DailyDigestSettingsInitial | null;
  available: boolean;
  digestRecipients: number;
}

/** First automation of the Automatisations page; config in tenant_feature_settings('daily_order_digest'). */
export function DailyDigestSettingsSection({ initial, available, digestRecipients }: Props) {
  const [status, setStatus] = useState(initial?.status ?? 'missing');
  const [form, setForm] = useState<Form | null>(() => {
    if (!initial) return null;
    const c = initial.config;
    return {
      enabled: initial.enabled, timezone: c.timezone, include_empty: c.include_empty,
      prepare_hours: c.prepare_hours, pickup_hours: c.pickup_hours,
      payment_verification_hours: c.payment_verification_hours, tracking_stale_hours: c.tracking_stale_hours,
    };
  });
  const [savedEnabled, setSavedEnabled] = useState(initial?.enabled ?? false);
  const [saving, setSaving] = useState(false);
  const { feedback, show } = useSettingsFeedback();
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((prev) => prev && ({ ...prev, [key]: value }));
  const disabled = !available || !form || saving;

  async function save() {
    if (!form) return;
    setSaving(true);
    const { enabled, ...config } = form;
    try {
      const response = await fetch('/api/admin/daily-digest', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled, config }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; status?: DailyDigestSettingsInitial['status'] };
      if (!response.ok) throw new Error(body.error || 'Enregistrement impossible.');
      if (body.status) setStatus(body.status);
      setSavedEnabled(enabled);
      show('Rapport quotidien configuré.', 'success');
    } catch (error) {
      show(error instanceof Error ? error.message : 'Enregistrement impossible.', 'error');
    } finally { setSaving(false); }
  }

  const badge = !available
    ? { label: 'Indisponible', tone: 'neutral' as const }
    : status === 'invalid'
      ? { label: 'Suspendu', tone: 'warning' as const }
      : savedEnabled ? { label: 'Actif', tone: 'ok' as const } : { label: 'Inactif', tone: 'neutral' as const };

  return (
    <article id="rapport-quotidien" aria-labelledby="rapport-quotidien-title" className="scroll-mt-24 overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <header className="flex items-start gap-4 border-b border-gray-100 px-4 py-4 sm:px-6 dark:border-gray-800">
        <SettingsIconTile icon={IconClockPlay} accent="amber" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2 id="rapport-quotidien-title" className="text-base font-semibold text-gray-950 dark:text-gray-100">Rapport quotidien des commandes</h2>
            <SettingsStatusBadge status={badge} />
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Tous les jours · 08:00 · {form?.timezone || 'fuseau non défini'}</p>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Un résumé des commandes nécessitant une action, envoyé par email.</p>
        </div>
      </header>

      <div className="space-y-6 px-4 py-5 sm:px-6">
        {!available && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">La migration 129 doit être appliquée avant d’utiliser ce rapport.</p>}
        {available && status === 'invalid' && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">La configuration enregistrée est invalide : le rapport est suspendu. Vérifiez les valeurs ci-dessous puis enregistrez.</p>}

        {form && <>
          <label className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-gray-200 px-4 py-3 dark:border-gray-800">
            <span>
              <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">Activer le rapport quotidien</span>
              <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">Nécessite le scheduler et le webhook e-mail n8n configurés.</span>
            </span>
            <input type="checkbox" disabled={disabled} checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} className="h-5 w-5 shrink-0 accent-[var(--admin-primary)]" />
          </label>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Seuils d’alerte</h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Une commande entre dans le rapport lorsqu’elle dépasse ces délais.</p>
            <ul className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {HOURS_FIELDS.map(({ key, label, hint, min }) => (
                <li key={key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <label htmlFor={`digest-${key}`} className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{hint} (min. {min} h, max. 336 h)</span>
                  </label>
                  <span className="flex items-center gap-2">
                    <input id={`digest-${key}`} className={`${SETTINGS_INPUT_CLS} w-24 text-right tabular-nums`} type="number" min={min} max={336} step={1}
                      disabled={disabled} value={Number.isFinite(form[key]) ? form[key] : ''} onChange={(e) => set(key, e.target.valueAsNumber)} />
                    <span aria-hidden="true" className="text-sm text-gray-500 dark:text-gray-400">h</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="digest-timezone" className={SETTINGS_LABEL_CLS}>Fuseau horaire IANA</label>
              <input id="digest-timezone" className={SETTINGS_INPUT_CLS} disabled={disabled} value={form.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Europe/Rome" autoComplete="off" aria-describedby="digest-timezone-hint" />
              <p id="digest-timezone-hint" className={SETTINGS_HINT_CLS}>L’envoi est prévu à 08:00 heure locale de ce fuseau.</p>
            </div>
            <label className="flex min-h-11 items-start gap-2.5 self-center text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" disabled={disabled} checked={form.include_empty} onChange={(e) => set('include_empty', e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--admin-primary)]" />
              Envoyer également un rapport lorsqu’aucune commande ne nécessite d’action
            </label>
          </div>
        </>}

        <p className={`rounded-xl px-4 py-3 text-sm ${digestRecipients > 0 ? 'bg-gray-50 text-gray-600 dark:bg-gray-800/60 dark:text-gray-300' : 'border border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'}`}>
          {digestRecipients > 0
            ? `${digestRecipients} destinataire${digestRecipients > 1 ? 's reçoivent' : ' reçoit'} ce rapport.`
            : 'Aucun destinataire actif ne reçoit ce rapport.'}{' '}
          <Link href="/admin/parametres/notifications" className="font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)]">Gérer les destinataires</Link>
        </p>
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-100 bg-gray-50/60 px-4 py-3 sm:px-6 dark:border-gray-800 dark:bg-gray-900/60">
        <SettingsFeedback feedback={feedback} />
        <Button type="button" onClick={() => void save()} disabled={disabled} loading={saving} className="min-h-11">Enregistrer</Button>
      </footer>
    </article>
  );
}
