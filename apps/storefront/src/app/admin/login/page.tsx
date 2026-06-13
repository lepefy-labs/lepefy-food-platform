'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get('error') === 'unauthorized') {
      setErrorMsg('Vous n\'êtes pas autorisé à accéder à cette page.');
    }
  }, [searchParams]);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setErrorMsg('Identifiants incorrects. Veuillez réessayer.');
      setLoading(false);
      return;
    }

    router.push('/admin');
    router.refresh();
  }

  const inputClass =
    'w-full text-sm px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-start">
      <div className="max-w-sm w-full mx-auto mt-24 bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
        <div className="text-center mb-8">
          <p className="text-lg font-bold text-gray-900">Chloé Food</p>
          <p className="text-xs text-gray-400 uppercase tracking-wide mt-1">Administration</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600" htmlFor="email">
              Adresse e-mail
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600" htmlFor="password">
              Mot de passe
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          {errorMsg && (
            <p className="text-xs text-red-500 text-center">{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-lg text-sm font-semibold text-white transition-opacity disabled:opacity-60"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
