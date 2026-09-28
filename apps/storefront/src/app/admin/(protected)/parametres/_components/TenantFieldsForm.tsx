'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import Button from '../../../_components/ui/Button';
import { SettingsFeedback, SettingsPanel, SETTINGS_HINT_CLS, SETTINGS_INPUT_CLS, SETTINGS_LABEL_CLS } from './SettingsUi';
import { useSettingsFeedback } from './useSettingsFeedback';

export interface TenantField {
  name: string;
  label: string;
  type?: 'text' | 'url' | 'email' | 'tel' | 'textarea';
  placeholder?: string;
  hint?: ReactNode;
  wide?: boolean;
  autoComplete?: string;
}

interface TenantFieldsFormProps {
  id: string;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  fields: TenantField[];
  initialValues: Record<string, string | null>;
  note?: ReactNode;
}

/**
 * Edits a subset of tenant columns through PATCH /api/admin/tenant. Only the
 * fields rendered by this form are sent, so each settings page saves its own
 * scope without touching values managed elsewhere.
 */
export function TenantFieldsForm({ id, title, description, aside, fields, initialValues, note }: TenantFieldsFormProps) {
  const formId = useId();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, initialValues[field.name] ?? ''])));
  const [saved, setSaved] = useState(values);
  const [isSaving, setIsSaving] = useState(false);
  const { feedback, show } = useSettingsFeedback();
  const dirty = fields.some((field) => values[field.name] !== saved[field.name]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/tenant', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || 'Erreur lors de l’enregistrement');
      }
      setSaved(values);
      show('Modifications enregistrées', 'success');
    } catch (error) {
      show(error instanceof Error ? error.message : 'Erreur lors de l’enregistrement', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <SettingsPanel
        id={id}
        title={title}
        description={description}
        aside={aside}
        footer={<>
          <SettingsFeedback feedback={feedback} />
          {dirty && !feedback && <span className="text-xs text-gray-500 dark:text-gray-400">Modifications non enregistrées</span>}
          <Button type="submit" loading={isSaving} disabled={!dirty} className="min-h-11">Enregistrer</Button>
        </>}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          {fields.map((field) => {
            const inputId = `${formId}-${field.name}`;
            const hintId = field.hint ? `${inputId}-hint` : undefined;
            const common = {
              id: inputId,
              name: field.name,
              value: values[field.name],
              placeholder: field.placeholder,
              'aria-describedby': hintId,
              className: SETTINGS_INPUT_CLS,
            };
            return (
              <div key={field.name} className={field.wide ? 'sm:col-span-2' : undefined}>
                <label htmlFor={inputId} className={SETTINGS_LABEL_CLS}>{field.label}</label>
                {field.type === 'textarea' ? (
                  <textarea {...common} rows={3} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} className={`${SETTINGS_INPUT_CLS} resize-y`} />
                ) : (
                  <input {...common} type={field.type ?? 'text'} autoComplete={field.autoComplete ?? 'off'} onChange={(event) => setValues({ ...values, [field.name]: event.target.value })} />
                )}
                {field.hint && <p id={hintId} className={SETTINGS_HINT_CLS}>{field.hint}</p>}
              </div>
            );
          })}
        </div>
        {note && <div className="mt-5">{note}</div>}
      </SettingsPanel>
    </form>
  );
}
