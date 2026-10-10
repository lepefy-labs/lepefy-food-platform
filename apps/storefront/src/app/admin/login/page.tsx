'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AdminOtpForm from './AdminOtpForm';
import AdminTenantIdentity from '../_components/AdminTenantIdentity';

export const dynamic = 'force-dynamic';
type LoginMode = 'otp' | 'password';
function safeNextPath(value: string | null) { return value && value.startsWith('/') && !value.startsWith('//') ? value : '/admin'; }

export default function AdminLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get('next'));
  const [mode, setMode] = useState<LoginMode>('otp');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [errorMsg, setErrorMsg] = useState(''); const [loading, setLoading] = useState(false);
  useEffect(() => { if (searchParams.get('error') === 'unauthorized') setErrorMsg("Vous n'êtes pas autorisé à accéder à cette page."); }, [searchParams]);
  async function handleSubmit(e: React.FormEvent) { e.preventDefault(); setErrorMsg(''); setLoading(true); const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); if (!res.ok) { setErrorMsg('Identifiants incorrects. Veuillez réessayer.'); setLoading(false); return; } router.refresh(); router.push(nextPath); }
  const inputClass = 'w-full rounded-lg border border-a-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-a-border focus:border-a-brand';
  return <div className="flex min-h-screen flex-col items-center justify-start bg-a-surface-2"><div className="mx-auto mt-16 w-full max-w-sm rounded-2xl border border-a-border bg-a-surface p-7 shadow-sm sm:mt-24 sm:p-8"><AdminTenantIdentity /><div className="my-6 h-px bg-a-hover" /><div className="mb-6 flex gap-1 rounded-lg bg-a-hover p-1 text-sm font-medium"><button type="button" onClick={() => setMode('otp')} className={`flex-1 rounded-md py-1.5 ${mode === 'otp' ? 'bg-a-surface text-a-text shadow-sm' : 'text-a-text-3'}`}>Code par email</button><button type="button" onClick={() => setMode('password')} className={`flex-1 rounded-md py-1.5 ${mode === 'password' ? 'bg-a-surface text-a-text shadow-sm' : 'text-a-text-3'}`}>Mot de passe</button></div>{errorMsg && <p className="mb-4 text-center text-xs text-tone-danger-fg">{errorMsg}</p>}{mode === 'otp' ? <AdminOtpForm nextPath={nextPath} /> : <form onSubmit={handleSubmit} className="flex flex-col gap-4"><div className="flex flex-col gap-1"><label className="text-xs font-medium text-a-text-2" htmlFor="email">Adresse e-mail</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputClass} /></div><div className="flex flex-col gap-1"><label className="text-xs font-medium text-a-text-2" htmlFor="password">Mot de passe</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className={inputClass} /></div><button type="submit" disabled={loading} className="w-full rounded-lg bg-a-brand py-2 text-sm font-semibold text-a-on-brand transition hover:bg-a-brand disabled:opacity-60">{loading ? 'Connexion…' : 'Se connecter'}</button></form>}<p className="mt-6 text-center text-xs text-a-text-3">Propulsé par Lepefy</p></div></div>;
}
