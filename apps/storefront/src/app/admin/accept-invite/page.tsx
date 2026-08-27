'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import AdminTenantIdentity from '../_components/AdminTenantIdentity';

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
    supabase.auth.getSession().then(({ data: { session } }) => setStatus(session ? 'ready' : 'invalid'));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    if (password.length < 8) { setErrorMsg('Le mot de passe doit contenir au moins 8 caractères.'); return; }
    if (password !== confirmPassword) { setErrorMsg('Les mots de passe ne correspondent pas.'); return; }
    setStatus('submitting');
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setErrorMsg('Erreur lors de la définition du mot de passe. Veuillez réessayer.'); setStatus('ready'); return; }
    setStatus('done');
    setTimeout(() => router.push('/admin/login'), 2000);
  }

  const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400';
  return (
    <div className="flex min-h-screen flex-col items-center justify-start bg-gray-50">
      <div className="mx-auto mt-16 w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-7 shadow-sm sm:mt-24 sm:p-8">
        <AdminTenantIdentity />
        <div className="my-6 h-px bg-gray-100" />
        {status === 'checking' && <p className="text-center text-sm text-gray-500">Vérification du lien...</p>}
        {status === 'invalid' && <div className="text-center"><p className="mb-4 text-sm text-red-500">Lien invalide ou expiré.</p><a href="/admin/login" className="text-sm font-medium text-violet-600">Retour à la connexion</a></div>}
        {status === 'done' && <p className="text-center text-sm text-green-600">Mot de passe défini. Redirection vers la connexion...</p>}
        {(status === 'ready' || status === 'submitting') && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div><h1 className="text-lg font-semibold text-gray-950">Créer votre accès administrateur</h1><p className="mt-1 text-sm text-gray-500">Définissez votre mot de passe pour rejoindre cet espace.</p></div>
            <div className="flex flex-col gap-1"><label className="text-xs font-medium text-gray-600" htmlFor="password">Mot de passe</label><input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} /></div>
            <div className="flex flex-col gap-1"><label className="text-xs font-medium text-gray-600" htmlFor="confirmPassword">Confirmer le mot de passe</label><input id="confirmPassword" type="password" autoComplete="new-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} /></div>
            {errorMsg && <p className="text-center text-xs text-red-500">{errorMsg}</p>}
            <button type="submit" disabled={status === 'submitting'} className="w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60">{status === 'submitting' ? 'Enregistrement…' : 'Définir le mot de passe'}</button>
          </form>
        )}
        <p className="mt-6 text-center text-[11px] text-gray-400">Propulsé par Lepefy</p>
      </div>
    </div>
  );
}
