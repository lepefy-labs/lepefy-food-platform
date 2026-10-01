'use client';

import { useState } from 'react';
import Button from '../../../../_components/ui/Button';
import { ErrorText, useGestionMutation } from '../../_components/useGestionMutation';
import { INPUT_CLS } from '../../_components/ui';

/** Modifier l'échéance de paiement (financière), indépendante de la livraison prévue. */
export function DueDateForm({ purchaseId, current }: { purchaseId: string; current: string | null }) {
  const { run, pending, error } = useGestionMutation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current ?? '');

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 text-sm font-medium text-[var(--admin-primary-fg)] hover:underline">
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
        <input type="date" className={`${INPUT_CLS} w-44`} value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <Button type="submit" loading={pending} className="min-h-11">Enregistrer</Button>
      {current && (
        <button type="button" onClick={() => setValue('')} className="min-h-11 px-2 text-sm text-gray-600 dark:text-gray-300">Retirer l&apos;échéance</button>
      )}
      <button type="button" onClick={() => { setOpen(false); setValue(current ?? ''); }} className="min-h-11 px-2 text-sm text-gray-600 dark:text-gray-300">Annuler</button>
      <ErrorText message={error} />
    </form>
  );
}
