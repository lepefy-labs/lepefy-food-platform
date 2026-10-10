'use client';

import { useState } from 'react';
import { IconEdit, IconNote, IconTag } from '@tabler/icons-react';
import Button from '@/app/admin/_components/ui/Button';
import Dialog from '@/app/admin/_components/ui/Dialog';
import { FormField, Input, Textarea } from '@/app/admin/_components/ui/Form';
import { ErrorText } from '@/app/admin/_components/ui/InlineAlert';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';

type Mode = 'edit' | 'note' | 'tag';

const TITLES: Record<Mode, string> = { edit: 'Modifier le client', note: 'Ajouter une note', tag: 'Ajouter un tag' };
const SUCCESS: Record<Mode, string> = { edit: 'Client mis à jour.', note: 'Note ajoutée.', tag: 'Tag ajouté.' };

export function CustomerActions({ customerId, profile }: { customerId: string; profile: { full_name: string | null; email: string | null; phone: string | null } }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const { run, pending, error, setError } = useAdminMutation();

  function open(next: Mode) { setError(null); setMode(next); }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode) return;
    const data = new FormData(event.currentTarget);
    const endpoint = mode === 'edit' ? `/api/admin/clients/${customerId}` : mode === 'note' ? `/api/admin/clients/${customerId}/notes` : `/api/admin/clients/${customerId}/tags`;
    const body = mode === 'edit'
      ? { fullName: data.get('fullName') || null, email: data.get('email') || null, phone: data.get('phone') || null }
      : mode === 'note' ? { body: data.get('body') } : { name: data.get('name') };
    const result = await run(endpoint, { method: mode === 'edit' ? 'PATCH' : 'POST', body, successMessage: SUCCESS[mode] });
    if (result) setMode(null);
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => open('edit')}><IconEdit size={17} aria-hidden="true" />Modifier</Button>
        <Button variant="secondary" onClick={() => open('note')}><IconNote size={17} aria-hidden="true" />Ajouter une note</Button>
        <Button variant="secondary" onClick={() => open('tag')}><IconTag size={17} aria-hidden="true" />Ajouter un tag</Button>
      </div>
      <Dialog
        open={mode !== null}
        onClose={() => setMode(null)}
        dismissible={!pending}
        size="sm"
        title={mode ? TITLES[mode] : ''}
        footer={<>
          <Button variant="secondary" onClick={() => setMode(null)} disabled={pending}>Annuler</Button>
          <Button type="submit" form="customer-action-form" loading={pending}>Enregistrer</Button>
        </>}
      >
        <form id="customer-action-form" onSubmit={submit} className="space-y-3">
          {mode === 'edit' && <>
            <FormField label="Nom"><Input name="fullName" defaultValue={profile.full_name ?? ''} autoFocus /></FormField>
            <FormField label="E-mail"><Input name="email" type="email" defaultValue={profile.email ?? ''} /></FormField>
            <FormField label="Téléphone"><Input name="phone" inputMode="tel" defaultValue={profile.phone ?? ''} /></FormField>
          </>}
          {mode === 'note' && <FormField label="Note interne" required><Textarea name="body" maxLength={4000} rows={5} autoFocus /></FormField>}
          {mode === 'tag' && <FormField label="Nom du tag" required><Input name="name" maxLength={60} placeholder="Ex. Grossiste" autoFocus /></FormField>}
          <ErrorText message={error} />
        </form>
      </Dialog>
    </>
  );
}
