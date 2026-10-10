'use client';

import { useState } from 'react';
import Button from '../../../_components/ui/Button';
import { useAdminMutation } from '@/app/admin/_components/ui/useAdminMutation';
import { ErrorText } from '@/app/admin/_components/ui/InlineAlert';
import { controlClasses } from '@/app/admin/_components/ui/Form';

/** Azione immediata (es. vérifier un paiement, passer commande). */
export function SimpleAction({ url, label, pendingLabel, variant = 'primary', body, confirmText }: {
  url: string; label: string; pendingLabel?: string; variant?: 'primary' | 'outline' | 'ghost';
  body?: Record<string, unknown>; confirmText?: string;
}) {
  const { run, pending, error } = useAdminMutation();
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
          <button type="button" onClick={() => setConfirming(false)} className="min-h-11 px-2 text-sm text-a-text-2 hover:text-a-text">
            Annuler
          </button>
        )}
      </div>
      {confirming && confirmText && <p className="text-xs text-a-text-2">{confirmText}</p>}
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
  const { run, pending, error } = useAdminMutation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const buttonTone = tone === 'danger'
    ? 'border-tone-danger-border text-tone-danger-fg hover:bg-tone-danger-bg'
    : 'border-a-border-strong text-a-text-2 hover:bg-a-surface-2';

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`inline-flex min-h-11 items-center rounded-lg border bg-a-surface px-3 text-sm font-medium ${buttonTone}`}>
        {label}
      </button>
    );
  }
  return (
    <form
      className="w-full space-y-2 rounded-xl border border-a-border bg-a-surface-2 p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await run(url, { body: { ...(body ?? {}), reason } });
        if (result) { setOpen(false); setReason(''); }
      }}
    >
      <p className="text-sm text-a-text-2">{description}</p>
      <label className="block">
        <span className="sr-only">Motif</span>
        <input className={controlClasses} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motif (obligatoire)" minLength={3} maxLength={1000} required autoFocus />
      </label>
      <ErrorText message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={pending} disabled={reason.trim().length < 3} className="min-h-11 !bg-tone-danger-solid">
          {confirmLabel}
        </Button>
        <button type="button" onClick={() => { setOpen(false); setReason(''); }} className="min-h-11 px-3 text-sm text-a-text-2 hover:text-a-text">
          Annuler
        </button>
      </div>
    </form>
  );
}
