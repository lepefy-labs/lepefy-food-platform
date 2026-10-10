'use client';

import { useState } from 'react';
import { IconSend } from '@tabler/icons-react';
import Button from '@/app/admin/_components/ui/Button';
import ConfirmDialog from '@/app/admin/_components/ui/ConfirmDialog';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';

export function DispatchButton({ id, disabled }: { id: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const { run, pending, error } = useAdminMutation();

  async function dispatch() {
    const result = await run(`/api/admin/clients/campaigns/${id}/dispatch`, { successMessage: 'Campagne transmise au provider.' });
    if (result) setOpen(false);
  }

  return (
    <>
      <Button disabled={disabled} onClick={() => setOpen(true)}>
        <IconSend size={18} aria-hidden="true" />Envoyer la campagne
      </Button>
      <ConfirmDialog
        open={open}
        title="Envoyer cette campagne ?"
        description="Le consentement marketing de chaque destinataire est figé à cet instant, puis la campagne est transmise au provider configuré."
        confirmLabel="Envoyer"
        loading={pending}
        error={error}
        onConfirm={() => void dispatch()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
