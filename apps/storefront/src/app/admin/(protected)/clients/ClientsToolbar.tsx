'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { IconDownload, IconPlus } from '@tabler/icons-react';
import Button, { ButtonAnchor } from '@/app/admin/_components/ui/Button';
import Dialog from '@/app/admin/_components/ui/Dialog';
import { FormField, Input } from '@/app/admin/_components/ui/Form';
import { ErrorText } from '@/app/admin/_components/ui/InlineAlert';

export function ClientsToolbar({ canManage }: { canManage: boolean }) {
  const router = useRouter(); const searchParams = useSearchParams();
  const [open, setOpen] = useState(canManage && searchParams.get('new') === '1'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');

  async function createCustomer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/admin/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: form.get('fullName') || null, email: form.get('email') || null, phone: form.get('phone') || null }) });
    const result = await response.json(); setBusy(false);
    if (!response.ok) { setError(result.error ?? 'Création impossible.'); return; }
    setOpen(false); router.push(`/admin/clients/${result.customerId}`); router.refresh();
  }

  return <>
    {/* Same filters as the list: the export follows what is on screen. */}
    <ButtonAnchor href={`/api/admin/clients/export?${searchParams.toString()}`}><IconDownload size={17} aria-hidden="true" />Exporter CSV</ButtonAnchor>
    {canManage && <Button onClick={() => setOpen(true)}><IconPlus size={17} aria-hidden="true" />Ajouter un client</Button>}
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
