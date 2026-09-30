'use client';

import { useState } from 'react';
import Button from '../../../_components/ui/Button';
import { ErrorText, useGestionMutation } from './useGestionMutation';
import { INPUT_CLS } from './ui';

/** Azione immediata (es. vérifier un paiement, passer commande). */
export function SimpleAction({ url, label, pendingLabel, variant = 'primary', body, confirmText }: {
  url: string; label: string; pendingLabel?: string; variant?: 'primary' | 'outline' | 'ghost';
  body?: Record<string, unknown>; confirmText?: string;
}) {
  const { run, pending, error } = useGestionMutation();
  const [confirming, setConfirming] = useState(false);
  async function submit() {
    if (confirmText && !confirming) { setConfirming(true); return; }
    await run(url, { body: body ?? {} });
    setConfirming(false);
  }
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={variant} loading={pending} onClick={submit} className="min-h-11">
          {pending ? pendingLabel ?? label : confirming ? `Confirmer : ${label.toLowerCase()}` : label}
        </Button>
        {confirming && !pending && (
          <button type="button" onClick={() => setConfirming(false)} className="min-h-11 px-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300">
            Annuler
          </button>
        )}
      </div>
      {confirming && confirmText && <p className="text-xs text-gray-600 dark:text-gray-300">{confirmText}</p>}
      <ErrorText message={error} />
    </div>
  );
}

/**
 * Azione correttiva con motivo obbligatorio, aperta sul posto (nessun overlay):
 * annulation d'achat, de réception, de paiement, retrait d'affectation.
 */
export function ReasonAction({ url, label, confirmLabel, description, body, tone = 'danger' }: {
  url: string; label: string; confirmLabel: string; description: string;
  body?: Record<string, unknown>; tone?: 'danger' | 'neutral';
}) {
  const { run, pending, error } = useGestionMutation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const buttonTone = tone === 'danger'
    ? 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30'
    : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800';

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`inline-flex min-h-11 items-center rounded-lg border bg-white px-3 text-sm font-medium dark:bg-gray-900 ${buttonTone}`}>
        {label}
      </button>
    );
  }
  return (
    <form
      className="w-full space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await run(url, { body: { ...(body ?? {}), reason } });
        if (result) { setOpen(false); setReason(''); }
      }}
    >
      <p className="text-sm text-gray-700 dark:text-gray-200">{description}</p>
      <label className="block">
        <span className="sr-only">Motif</span>
        <input className={INPUT_CLS} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motif (obligatoire)" minLength={3} maxLength={1000} required autoFocus />
      </label>
      <ErrorText message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending} disabled={reason.trim().length < 3} className="min-h-11 !bg-red-700">
          {confirmLabel}
        </Button>
        <button type="button" onClick={() => { setOpen(false); setReason(''); }} className="min-h-11 px-3 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300">
          Annuler
        </button>
      </div>
    </form>
  );
}
