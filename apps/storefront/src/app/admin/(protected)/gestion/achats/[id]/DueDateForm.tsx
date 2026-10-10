'use client';

import { useState } from 'react';
import Button from '../../../../_components/ui/Button';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';
import { ErrorText } from '@/app/admin/_components/ui/InlineAlert';
import { controlClasses } from '@/app/admin/_components/ui/Form';

/** Modifier l'échéance de paiement (financière), indépendante de la livraison prévue. */
export function DueDateForm({ purchaseId, current }: { purchaseId: string; current: string | null }) {
  const { run, pending, error } = useAdminMutation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current ?? '');

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 text-sm font-medium text-a-brand-fg hover:underline">
        {current ? 'Modifier l\'échéance' : 'Définir une échéance'}
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await run(`/api/admin/gestion/purchases/${purchaseId}/due-date`, { body: { payment_due_date: value || null } });
        if (result) setOpen(false);
      }}
    >
      <label>
        <span className="sr-only">Échéance de paiement</span>
        <input type="date" className={`${controlClasses} w-44`} value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <Button type="submit" loading={pending} className="min-h-11">Enregistrer</Button>
      {current && (
        <button type="button" onClick={() => setValue('')} className="min-h-11 px-2 text-sm text-a-text-2">Retirer l&apos;échéance</button>
      )}
      <button type="button" onClick={() => { setOpen(false); setValue(current ?? ''); }} className="min-h-11 px-2 text-sm text-a-text-2">Annuler</button>
      <ErrorText message={error} />
    </form>
  );
}
