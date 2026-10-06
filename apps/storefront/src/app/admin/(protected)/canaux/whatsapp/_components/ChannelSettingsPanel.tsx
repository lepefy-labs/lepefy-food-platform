'use client';

import { useState } from 'react';
import Button from '../../../../_components/ui/Button';
import type { ChannelView } from '@/lib/whatsapp/adminSchemas';
import { SettingsFeedback, SETTINGS_HINT_CLS, SETTINGS_INPUT_CLS, SETTINGS_LABEL_CLS } from '../../../parametres/_components/SettingsUi';
import { useSettingsFeedback } from '../../../parametres/_components/useSettingsFeedback';

type Form = {
  automation_enabled: boolean;
  ai_enabled: boolean;
  human_handoff_enabled: boolean;
  default_language: 'fr' | 'it' | 'en';
  auto_resume_minutes: number | null;
};

function toForm(view: ChannelView): Form {
  return {
    automation_enabled: view.automationEnabled,
    ai_enabled: view.aiEnabled,
    human_handoff_enabled: view.humanHandoffEnabled,
    default_language: (['fr', 'it', 'en'].includes(view.defaultLanguage) ? view.defaultLanguage : 'fr') as Form['default_language'],
    auto_resume_minutes: view.autoResumeMinutes,
  };
}

const TOGGLES: ReadonlyArray<{ key: 'automation_enabled' | 'ai_enabled' | 'human_handoff_enabled'; label: string; hint: string }> = [
  { key: 'automation_enabled', label: 'Réponses automatiques', hint: 'Horaires, adresse, livraison, catalogue, disponibilité et commandes, à partir des données de la boutique.' },
  { key: 'ai_enabled', label: 'Nala', hint: 'Répond aux autres questions. Jamais sur les paiements, les commandes ou les frais de livraison.' },
  { key: 'human_handoff_enabled', label: 'Passage à un opérateur', hint: 'Réclamation, paiement, colis non reçu ou demande explicite : l’automatisation se met en pause.' },
];

/** Réglages opérationnels du canal (whatsapp.manage). */
export default function ChannelSettingsPanel({ initial, canManage }: { initial: ChannelView; canManage: boolean }) {
  const [saved, setSaved] = useState<Form>(() => toForm(initial));
  const [form, setForm] = useState<Form>(() => toForm(initial));
  const [saving, setSaving] = useState(false);
  const { feedback, show } = useSettingsFeedback();
  const dirty = (Object.keys(form) as Array<keyof Form>).some((key) => form[key] !== saved[key]);
  const disabled = !canManage || saving;
  const notActive = initial.status !== 'active';

  async function save() {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/whatsapp/channel/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; channel?: ChannelView };
      if (!response.ok || !body.channel) throw new Error(body.error || 'Enregistrement impossible.');
      const next = toForm(body.channel);
      setSaved(next);
      setForm(next);
      show('Réglages WhatsApp enregistrés.', 'success');
    } catch (error) {
      show(error instanceof Error ? error.message : 'Enregistrement impossible.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-1 text-base font-semibold text-gray-950 dark:text-white">Fonctionnement</h2>
      {notActive && <p className={SETTINGS_HINT_CLS}>Canal en test : les messages sont enregistrés mais aucune réponse automatique n’est envoyée tant qu’il n’est pas actif.</p>}
      <div className="mt-3 space-y-3">
        {TOGGLES.map((toggle) => (
          <label key={toggle.key} className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-gray-300"
              checked={form[toggle.key]}
              disabled={disabled || (toggle.key === 'ai_enabled' && !form.automation_enabled)}
              onChange={(event) => setForm((prev) => ({ ...prev, [toggle.key]: event.target.checked }))}
            />
            <span>
              <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{toggle.label}</span>
              <span className={SETTINGS_HINT_CLS}>{toggle.hint}</span>
            </span>
          </label>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="wa-language" className={SETTINGS_LABEL_CLS}>Langue par défaut</label>
            <select id="wa-language" className={SETTINGS_INPUT_CLS} value={form.default_language} disabled={disabled}
              onChange={(event) => setForm((prev) => ({ ...prev, default_language: event.target.value as Form['default_language'] }))}>
              <option value="fr">Français</option>
              <option value="it">Italiano</option>
              <option value="en">English</option>
            </select>
            <p className={SETTINGS_HINT_CLS}>Utilisée si la langue du client n’est pas reconnue.</p>
          </div>
          <div>
            <label htmlFor="wa-resume" className={SETTINGS_LABEL_CLS}>Reprise automatique</label>
            <select id="wa-resume" className={SETTINGS_INPUT_CLS} value={form.auto_resume_minutes ?? ''} disabled={disabled}
              onChange={(event) => setForm((prev) => ({ ...prev, auto_resume_minutes: event.target.value ? Number(event.target.value) : null }))}>
              <option value="">Jamais (reprise manuelle)</option>
              <option value="60">Après 1 heure</option>
              <option value="240">Après 4 heures</option>
              <option value="1440">Après 24 heures</option>
            </select>
            <p className={SETTINGS_HINT_CLS}>Après un passage à un opérateur sans prise en main.</p>
          </div>
        </div>
      </div>
      {canManage && (
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={save} loading={saving} disabled={!dirty}>Enregistrer</Button>
          <SettingsFeedback feedback={feedback} />
        </div>
      )}
    </section>
  );
}
