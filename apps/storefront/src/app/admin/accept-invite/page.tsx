'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Page hors du groupe (protected) — même raison que loyalty/scan et
// evenementiel/scan : elle doit être atteignable AVANT que l'utilisateur ait
// une session admin valide vérifiable par le layout partagé (le layout exige
// une ligne admin_users active, qui n'existe pas forcément encore ici).
export const dynamic = 'force-dynamic';

type Status = 'checking' | 'ready' | 'invalid' | 'submitting' | 'done';

export default function AcceptInvitePage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const supabase = createClient();
    // detectSessionInUrl (actif par défaut sur createBrowserClient) échange
    // le token du lien d'invitation (hash fragment #access_token=... ou
    // ?code=... selon le flow) dès le chargement du client — un court délai
    // suffit à laisser cet échange se terminer avant de vérifier la session.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setStatus(session ? 'ready' : 'invalid');
    });
  }, []);

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

    setStatus('submitting');
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setErrorMsg('Erreur lors de la définition du mot de passe. Veuillez réessayer.');
      setStatus('ready');
      return;
    }

    setStatus('done');
    setTimeout(() => router.push('/admin/login'), 2000);
  }

  const inputClass =
    'w-full text-sm px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-start">
      <div className="max-w-sm w-full mx-auto mt-24 bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
        <div className="text-center mb-8">
          <p className="text-lg font-bold text-gray-900">Lepefy Food</p>
          <p className="text-xs text-gray-400 uppercase tracking-wide mt-1">Administration</p>
        </div>

        {status === 'checking' && (
          <p className="text-sm text-gray-500 text-center">Vérification du lien...</p>
        )}

        {status === 'invalid' && (
          <div className="text-center">
            <p className="text-sm text-red-500 mb-4">Lien invalide ou expiré.</p>
            <a href="/admin/login" className="text-sm text-[var(--color-primary)] font-medium">
              Retour à la connexion
            </a>
          </div>
        )}

        {status === 'done' && (
          <p className="text-sm text-green-600 text-center">
            Mot de passe défini. Redirection vers la connexion...
          </p>
        )}

        {(status === 'ready' || status === 'submitting') && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600" htmlFor="password">
                Mot de passe
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600" htmlFor="confirmPassword">
                Confirmer le mot de passe
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
              />
            </div>

            {errorMsg && (
              <p className="text-xs text-red-500 text-center">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full py-2 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-60"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {status === 'submitting' ? 'Enregistrement…' : 'Définir le mot de passe'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
