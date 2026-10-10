'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconPlus } from '@tabler/icons-react';
import Button from '@/app/admin/_components/ui/Button';
import Dialog from '@/app/admin/_components/ui/Dialog';
import { FormField, Input, Select, Textarea } from '@/app/admin/_components/ui/Form';
import { ErrorText } from '@/app/admin/_components/ui/InlineAlert';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';

export function CampaignComposer({ segments }: { segments: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { run, pending, error, setError } = useAdminMutation();

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await run<{ id: string }>('/api/admin/clients/campaigns', {
      body: { name: form.get('name'), channel: 'email', segmentId: form.get('segmentId') || null, subject: form.get('subject') || null, content: form.get('content') },
      refresh: false,
    });
    if (result) router.push(`/admin/clients/campagnes/${result.id}`);
  }

  return (
    <>
      <Button onClick={() => { setError(null); setOpen(true); }}><IconPlus size={18} aria-hidden="true" />Créer une campagne</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!pending}
        title="Nouvelle campagne e-mail"
        description="Les destinataires sans consentement marketing courant seront exclus par le serveur."
        footer={<>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
          <Button type="submit" form="campaign-composer-form" loading={pending}>Créer le brouillon</Button>
        </>}
      >
        <form id="campaign-composer-form" onSubmit={save} className="space-y-3">
          <FormField label="Nom interne" required><Input name="name" maxLength={120} autoFocus /></FormField>
          <FormField label="Destinataires">
            <Select name="segmentId" defaultValue="">
              <option value="">Tous les clients autorisés</option>
              {segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Objet" optional><Input name="subject" maxLength={180} /></FormField>
          <FormField label="Contenu de la campagne" required><Textarea name="content" maxLength={20000} rows={8} /></FormField>
          <ErrorText message={error} />
        </form>
      </Dialog>
    </>
  );
}
