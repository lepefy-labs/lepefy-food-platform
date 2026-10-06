'use client';

import { useState } from 'react';
import Button from '../../../../_components/ui/Button';
import type { RuleCode } from '@/lib/whatsapp/automation/rules';
import { SettingsFeedback, SETTINGS_HINT_CLS, SETTINGS_INPUT_CLS, SETTINGS_LABEL_CLS } from '../../../parametres/_components/SettingsUi';
import { useSettingsFeedback } from '../../../parametres/_components/useSettingsFeedback';

export interface EditableRule {
  code: RuleCode;
  label: string;
  description: string;
  enabled: boolean;
  priority: number;
  configuration: Record<string, unknown>;
}

/** Champs texte configurables par règle (le reste des données vient de la boutique). */
const TEXT_FIELDS: Partial<Record<RuleCode, { key: string; label: string; hint: string; max: number; multiline?: boolean }>> = {
  greeting: { key: 'message', label: 'Message d’accueil', hint: 'Vide = message par défaut. {boutique} est remplacé par le nom de la boutique.', max: 600, multiline: true },
  human_handoff: { key: 'message', label: 'Message au client', hint: 'Vide = message par défaut (« Je transmets votre demande à l’équipe… »).', max: 400, multiline: true },
  shipping: { key: 'extra_note', label: 'Précision ajoutée', hint: 'Ajoutée après les informations réelles de livraison. N’y indiquez pas de tarifs.', max: 400, multiline: true },
  catalog: { key: 'path', label: 'Page du catalogue', hint: 'Chemin relatif à la boutique (défaut /products).', max: 120 },
};

export default function RulesEditor({ initial, canManage }: { initial: EditableRule[]; canManage: boolean }) {
  const [rules, setRules] = useState(initial);
  const [saving, setSaving] = useState(false);
  const { feedback, show } = useSettingsFeedback();
  const update = (code: RuleCode, patch: Partial<EditableRule>) => setRules((prev) => prev.map((rule) => rule.code === code ? { ...rule, ...patch } : rule));

  async function save() {
    setSaving(true);
    try {
      const payload = rules.map((rule) => ({
        code: rule.code,
        enabled: rule.enabled,
        priority: rule.priority,
        configuration: Object.fromEntries(Object.entries(rule.configuration).filter(([, value]) => value !== '' && value !== undefined)),
      }));
      const response = await fetch('/api/admin/whatsapp/rules', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: payload }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; rules?: EditableRule[] };
      if (!response.ok || !body.rules) throw new Error(body.error || 'Enregistrement impossible.');
      setRules(body.rules);
      show('Automatisations enregistrées.', 'success');
    } catch (error) {
      show(error instanceof Error ? error.message : 'Enregistrement impossible.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {rules.map((rule) => {
        const field = TEXT_FIELDS[rule.code];
        const value = field ? String(rule.configuration[field.key] ?? '') : '';
        return (
          <article key={rule.code} className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <label className="flex min-w-0 flex-1 items-start gap-3">
                <input type="checkbox" className="mt-1 h-4 w-4 rounded border-gray-300" checked={rule.enabled} disabled={!canManage}
                  onChange={(event) => update(rule.code, { enabled: event.target.checked })} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">{rule.label}</span>
                  <span className={SETTINGS_HINT_CLS}>{rule.description}</span>
                </span>
              </label>
              <div className="flex items-center gap-2">
                <label htmlFor={`priority-${rule.code}`} className="text-xs text-gray-500 dark:text-gray-400">Priorité</label>
                <input id={`priority-${rule.code}`} type="number" min={0} max={1000} className={`${SETTINGS_INPUT_CLS} w-20`} value={rule.priority} disabled={!canManage}
                  onChange={(event) => update(rule.code, { priority: Math.max(0, Math.min(1000, Number(event.target.value) || 0)) })} />
              </div>
            </div>
            {field && (
              <div className="mt-3">
                <label htmlFor={`field-${rule.code}`} className={SETTINGS_LABEL_CLS}>{field.label}</label>
                {field.multiline ? (
                  <textarea id={`field-${rule.code}`} rows={2} maxLength={field.max} className={SETTINGS_INPUT_CLS} value={value} disabled={!canManage}
                    onChange={(event) => update(rule.code, { configuration: { ...rule.configuration, [field.key]: event.target.value } })} />
                ) : (
                  <input id={`field-${rule.code}`} maxLength={field.max} className={SETTINGS_INPUT_CLS} value={value} disabled={!canManage}
                    onChange={(event) => update(rule.code, { configuration: { ...rule.configuration, [field.key]: event.target.value } })} />
                )}
                <p className={SETTINGS_HINT_CLS}>{field.hint}</p>
              </div>
            )}
          </article>
        );
      })}
      {canManage && (
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={save} loading={saving}>Enregistrer</Button>
          <SettingsFeedback feedback={feedback} />
        </div>
      )}
      <p className={SETTINGS_HINT_CLS}>Plus la priorité est basse, plus la règle passe tôt. Le passage à un opérateur s’applique toujours avant les autres règles.</p>
    </div>
  );
}
