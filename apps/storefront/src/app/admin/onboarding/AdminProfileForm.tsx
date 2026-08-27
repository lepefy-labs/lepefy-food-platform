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

export default function AdminProfileForm({ email, initial, nextPath, editing = false }: AdminProfileFormProps) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const response = await fetch('/api/admin/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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

  const inputClass = 'mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200';
  const labelClass = 'text-xs font-semibold text-gray-600';

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
        <span className="text-xs text-gray-400">Compte</span>
        <p className="font-medium text-gray-800">{email}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>Prénom *
          <input autoComplete="given-name" required minLength={2} maxLength={80} className={inputClass} value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />
        </label>
        <label className={labelClass}>Nom *
          <input autoComplete="family-name" required minLength={2} maxLength={80} className={inputClass} value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />
        </label>
      </div>

      <label className={labelClass}>Nickname *
        <input required minLength={2} maxLength={60} className={inputClass} value={form.nickname} onChange={(event) => setForm({ ...form, nickname: event.target.value })} placeholder="Nom affiché dans les opérations et audits" />
        <span className="mt-1 block text-[11px] font-normal text-gray-400">Utilisé dans l’interface et les historiques opérationnels.</span>
      </label>

      <label className={labelClass}>Téléphone
        <input autoComplete="tel" maxLength={30} className={inputClass} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Optionnel" />
      </label>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <button type="submit" disabled={saving} className="flex min-h-11 w-full items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60">
        {saving ? 'Enregistrement…' : editing ? 'Enregistrer le profil' : 'Terminer la configuration'}
      </button>
    </form>
  );
}
