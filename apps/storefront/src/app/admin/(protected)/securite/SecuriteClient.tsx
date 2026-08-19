'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';

const INPUT_CLS =
  'w-full text-sm px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

type Status = 'idle' | 'saving' | 'done' | 'session-error';

export default function SecuriteClient() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    if (password.length < 8) {
      setErrorMsg('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Les mots de passe ne correspondent pas.');
      return;
    }

    setStatus('saving');
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setStatus('session-error');
      return;
    }

    setPassword('');
    setConfirmPassword('');
    setStatus('done');
  }

  if (status === 'session-error') {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <p className="text-sm text-red-500 mb-3">
          Erreur lors de la mise à jour du mot de passe. Votre session a peut-être expiré.
        </p>
        <Link href="/admin/login" className="text-sm text-[var(--color-primary)] font-medium">
          Retour à la connexion
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400" htmlFor="password">
            Nouveau mot de passe
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT_CLS}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400" htmlFor="confirmPassword">
            Confirmer le mot de passe
          </label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={INPUT_CLS}
          />
        </div>

        {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}
        {status === 'done' && (
          <p className="text-xs text-green-600">Mot de passe mis à jour avec succès.</p>
        )}

        <button
          type="submit"
          disabled={status === 'saving'}
          className="w-full py-2 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-60"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {status === 'saving' ? 'Enregistrement…' : 'Mettre à jour le mot de passe'}
        </button>
      </form>
    </div>
  );
}
