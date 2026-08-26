'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AdminOtpForm from './AdminOtpForm';

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
  const inputClass = 'w-full text-sm px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';
  return <div className="flex min-h-screen flex-col items-center justify-start bg-gray-50"><div className="mx-auto mt-24 w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-8 shadow-sm"><div className="mb-8 text-center"><p className="text-lg font-bold text-gray-900">Chloé Food</p><p className="mt-1 text-xs uppercase tracking-wide text-gray-400">Administration</p></div><div className="mb-6 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm font-medium"><button type="button" onClick={() => setMode('otp')} className={`flex-1 rounded-md py-1.5 ${mode === 'otp' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Code par email</button><button type="button" onClick={() => setMode('password')} className={`flex-1 rounded-md py-1.5 ${mode === 'password' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Mot de passe</button></div>{errorMsg && <p className="mb-4 text-center text-xs text-red-500">{errorMsg}</p>}{mode === 'otp' ? <AdminOtpForm nextPath={nextPath} /> : <form onSubmit={handleSubmit} className="flex flex-col gap-4"><div className="flex flex-col gap-1"><label className="text-xs font-medium text-gray-600" htmlFor="email">Adresse e-mail</label><input id="email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className={inputClass} /></div><div className="flex flex-col gap-1"><label className="text-xs font-medium text-gray-600" htmlFor="password">Mot de passe</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className={inputClass} /></div><button type="submit" disabled={loading} className="w-full rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: 'var(--color-primary)' }}>{loading ? 'Connexion…' : 'Se connecter'}</button></form>}</div></div>;
}
