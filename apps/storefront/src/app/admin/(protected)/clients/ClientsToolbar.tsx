'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IconDownload, IconPlus, IconSearch, IconX } from '@tabler/icons-react';

export function ClientsToolbar() {
  const router = useRouter(); const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [open, setOpen] = useState(searchParams.get('new') === '1'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const initial = useRef(true);
  useEffect(() => {
    if (initial.current) { initial.current = false; return; }
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (query.trim()) params.set('q', query.trim()); else params.delete('q');
      params.delete('page'); router.replace(`/admin/clients?${params.toString()}`);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query, router, searchParams]);

  async function createCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/admin/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: form.get('fullName') || null, email: form.get('email') || null, phone: form.get('phone') || null }) });
    const result = await response.json(); setBusy(false);
    if (!response.ok) { setError(result.error ?? 'Création impossible.'); return; }
    setOpen(false); router.push(`/admin/clients/${result.customerId}`); router.refresh();
  }

  return <>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="relative block min-w-0 flex-1 sm:w-72 sm:flex-none"><IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} /><span className="sr-only">Rechercher un client</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, e-mail, téléphone, carte…" className="h-11 w-full rounded-xl border border-[var(--admin-border)] bg-white pl-10 pr-9 text-sm outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:bg-gray-900" />{query && <button type="button" onClick={() => setQuery('')} className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center" aria-label="Effacer"><IconX size={16} /></button>}</label>
      <a href={`/api/admin/clients/export?${searchParams.toString()}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--admin-border)] bg-white px-4 text-sm font-semibold dark:bg-gray-900"><IconDownload size={18} />Exporter CSV</a>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white"><IconPlus size={18} />Ajouter un client</button>
    </div>
    {open && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={() => setOpen(false)}><div role="dialog" aria-modal="true" aria-labelledby="new-client-title" onMouseDown={(event) => event.stopPropagation()} className="w-full rounded-t-3xl bg-white p-5 shadow-xl dark:bg-gray-900 sm:max-w-md sm:rounded-2xl"><div className="flex items-center justify-between"><h2 id="new-client-title" className="text-lg font-semibold">Ajouter un client</h2><button onClick={() => setOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-xl" aria-label="Fermer"><IconX /></button></div><p className="mt-1 text-sm text-gray-500">Le profil CRM est créé sans compte de connexion.</p><form onSubmit={createCustomer} className="mt-5 space-y-3"><input name="fullName" maxLength={160} placeholder="Nom complet" className="h-11 w-full rounded-xl border border-gray-200 px-3 dark:border-gray-700 dark:bg-gray-950" /><input name="email" type="email" maxLength={254} placeholder="E-mail" className="h-11 w-full rounded-xl border border-gray-200 px-3 dark:border-gray-700 dark:bg-gray-950" /><input name="phone" maxLength={40} placeholder="Téléphone" className="h-11 w-full rounded-xl border border-gray-200 px-3 dark:border-gray-700 dark:bg-gray-950" />{error && <p className="text-sm text-red-600">{error}</p>}<button disabled={busy} className="min-h-11 w-full rounded-xl bg-[var(--admin-primary)] px-4 font-semibold text-white disabled:opacity-60">{busy ? 'Création…' : 'Créer le client'}</button></form></div></div>}
  </>;
}
