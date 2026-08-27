'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

interface AdminProfileFormProps {
  email: string;
  initial: {
    firstName: string;
    lastName: string;
    nickname: string;
    phone: string;
  };
  nextPath: string;
  editing?: boolean;
}

type FieldErrors = Partial<Record<'firstName' | 'lastName' | 'nickname', string>>;

export default function AdminProfileForm({ email, initial, nextPath, editing = false }: AdminProfileFormProps) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const dirty = form.firstName !== initial.firstName
    || form.lastName !== initial.lastName
    || form.nickname !== initial.nickname
    || form.phone !== initial.phone;

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (form.firstName.trim().length < 2) errors.firstName = 'Renseignez votre prénom.';
    if (form.lastName.trim().length < 2) errors.lastName = 'Renseignez votre nom.';
    if (form.nickname.trim().length < 2) errors.nickname = 'Choisissez un nom affiché.';
    return errors;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const validationErrors = validate();
    setFieldErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSaving(true);
    try {
      const response = await fetch('/api/admin/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          nickname: form.nickname.trim(),
          phone: form.phone.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? 'Impossible d’enregistrer votre profil.');
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch {
      setError('Impossible d’enregistrer votre profil.');
    } finally {
      setSaving(false);
    }
  }

  function onCancel() {
    if (!editing || saving) return;
    if (dirty && !window.confirm('Quitter sans enregistrer vos modifications ?')) return;
    router.push(nextPath);
  }

  function updateField(field: keyof typeof form, value: string) {
    setForm(current => ({ ...current, [field]: value }));
    if (field === 'firstName' || field === 'lastName' || field === 'nickname') {
      setFieldErrors(current => ({ ...current, [field]: undefined }));
    }
  }

  const inputClass = 'mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-200';
  const labelClass = 'text-xs font-semibold text-gray-700';
  const errorInputClass = 'border-red-300 focus:border-red-400 focus:ring-red-100';

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5">
      <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
        <span className="text-xs text-gray-400">Compte</span>
        <p className="mt-0.5 break-all font-medium text-gray-800">{email}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>Prénom <span aria-hidden="true">*</span>
          <input
            autoComplete="given-name"
            maxLength={80}
            aria-invalid={Boolean(fieldErrors.firstName)}
            aria-describedby={fieldErrors.firstName ? 'first-name-error' : undefined}
            className={`${inputClass} ${fieldErrors.firstName ? errorInputClass : ''}`}
            value={form.firstName}
            onChange={(event) => updateField('firstName', event.target.value)}
          />
          {fieldErrors.firstName && <span id="first-name-error" className="mt-1.5 block text-[11px] font-medium text-red-600">{fieldErrors.firstName}</span>}
        </label>

        <label className={labelClass}>Nom <span aria-hidden="true">*</span>
          <input
            autoComplete="family-name"
            maxLength={80}
            aria-invalid={Boolean(fieldErrors.lastName)}
            aria-describedby={fieldErrors.lastName ? 'last-name-error' : undefined}
            className={`${inputClass} ${fieldErrors.lastName ? errorInputClass : ''}`}
            value={form.lastName}
            onChange={(event) => updateField('lastName', event.target.value)}
          />
          {fieldErrors.lastName && <span id="last-name-error" className="mt-1.5 block text-[11px] font-medium text-red-600">{fieldErrors.lastName}</span>}
        </label>
      </div>

      <div className="border-t border-gray-100 pt-1">
        <label className={labelClass}>Nom affiché <span aria-hidden="true">*</span>
          <input
            maxLength={60}
            aria-invalid={Boolean(fieldErrors.nickname)}
            aria-describedby="nickname-help nickname-error"
            className={`${inputClass} ${fieldErrors.nickname ? errorInputClass : ''}`}
            value={form.nickname}
            onChange={(event) => updateField('nickname', event.target.value)}
            placeholder="Ex. Robertin, Marie, Équipe caisse"
          />
          <span id="nickname-help" className="mt-1.5 block text-[11px] font-normal leading-4 text-gray-400">Visible dans l’interface et les historiques opérationnels.</span>
          {fieldErrors.nickname && <span id="nickname-error" className="mt-1 block text-[11px] font-medium text-red-600">{fieldErrors.nickname}</span>}
        </label>
      </div>

      <label className={labelClass}>Téléphone <span className="font-normal text-gray-400">(optionnel)</span>
        <input
          autoComplete="tel"
          inputMode="tel"
          maxLength={30}
          className={inputClass}
          value={form.phone}
          onChange={(event) => updateField('phone', event.target.value)}
          placeholder="+33 …"
        />
      </label>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">{error}</p>}

      {editing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={saving}
            onClick={onCancel}
            className="flex min-h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Annuler
          </button>
          <button type="submit" disabled={saving} className="flex min-h-11 items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? 'Enregistrement…' : 'Enregistrer le profil'}
          </button>
        </div>
      ) : (
        <button type="submit" disabled={saving} className="flex min-h-11 w-full items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60">
          {saving ? 'Enregistrement…' : 'Terminer la configuration'}
        </button>
      )}
    </form>
  );
}
