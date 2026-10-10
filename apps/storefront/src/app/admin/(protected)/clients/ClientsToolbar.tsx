'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IconDownload, IconPlus, IconSearch, IconX } from '@tabler/icons-react';
import Button from '@/app/admin/_components/ui/Button';
import Dialog from '@/app/admin/_components/ui/Dialog';
import { FormField, Input } from '@/app/admin/_components/ui/Form';
import { ErrorText } from '@/app/admin/_components/ui/InlineAlert';

export function ClientsToolbar({ canManage }: { canManage: boolean }) {
  const router = useRouter(); const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [open, setOpen] = useState(canManage && searchParams.get('new') === '1'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
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
      {canManage && <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white"><IconPlus size={18} aria-hidden="true" />Ajouter un client</button>}
    </div>
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      dismissible={!busy}
      size="sm"
      title="Ajouter un client"
      description="Le profil CRM est créé sans compte de connexion."
      footer={<>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>Annuler</Button>
        <Button type="submit" form="new-client-form" loading={busy}>Créer le client</Button>
      </>}
    >
      <form id="new-client-form" onSubmit={createCustomer} className="space-y-3">
        <FormField label="Nom complet"><Input name="fullName" maxLength={160} autoFocus /></FormField>
        <FormField label="E-mail"><Input name="email" type="email" maxLength={254} /></FormField>
        <FormField label="Téléphone"><Input name="phone" maxLength={40} inputMode="tel" placeholder="+39 …" /></FormField>
        <ErrorText message={error} />
      </form>
    </Dialog>
  </>;
}
