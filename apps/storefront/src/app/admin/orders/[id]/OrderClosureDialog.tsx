'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconAlertTriangle, IconCopy, IconCreditCard, IconTruck } from '@tabler/icons-react';
import {
  allowedNotifications, CLOSURE_MESSAGE_MAX, CLOSURE_MESSAGE_MIN, CLOSURE_NOTE_MAX, CLOSURE_NOTIFICATION_LABELS,
  CLOSURE_REASON_HINTS, CLOSURE_REASON_LABELS, CLOSURE_REASONS, closureIssues, closureShipmentGuard, closureTypeFor,
  defaultClosureMessage, type ClosureNotification, type ClosureOrderFacts, type ClosureReason,
} from '@/lib/orders/closure/closureRules';
import Badge from '../../_components/ui/Badge';
import Button from '../../_components/ui/Button';
import Dialog from '../../_components/ui/Dialog';
import { FormField, Textarea } from '../../_components/ui/Form';
import InlineAlert from '../../_components/ui/InlineAlert';
import { useAdminToast } from '../../_components/ui/Toaster';
import { cn } from '@/lib/utils/cn';

export interface OrderClosureDialogProps {
  open: boolean;
  onClose: () => void;
  order: ClosureOrderFacts & { id: string; full_name: string | null; payment_status: string };
  tenantName: string;
  totalLabel: string;
  paymentLabel: string;
}

function Choice({ name, checked, onChange, title, hint, disabled }: { name: string; checked: boolean; onChange: () => void; title: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cn('flex min-h-11 items-start gap-3 rounded-xl border p-3', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      checked ? 'border-a-brand bg-a-brand-soft' : 'border-a-border bg-a-surface hover:bg-a-hover')}>
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--admin-primary)]" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-a-text">{title}</span>
        {hint && <span className="mt-0.5 block text-xs leading-5 text-a-text-2">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Two steps: choose (reason, communication, message) → verify (payment and
 * carrier warnings, summary) → confirm. Rules from closureRules, re-run on the
 * server; the dialog cannot be dismissed while the request runs.
 */
export default function OrderClosureDialog({ open, onClose, order, tenantName, totalLabel, paymentLabel }: OrderClosureDialogProps) {
  const router = useRouter();
  const toast = useAdminToast();
  const orderNumber = `#${order.id.slice(0, 8).toUpperCase()}`;
  const firstName = order.full_name?.trim().split(/\s+/)[0] ?? null;
  const hasEmail = Boolean(order.email);
  const [step, setStep] = useState<1 | 2>(1);
  const [reason, setReason] = useState<ClosureReason | null>(null);
  const [notification, setNotification] = useState<ClosureNotification>('none');
  const [message, setMessage] = useState('');
  const [messageTouched, setMessageTouched] = useState(false);
  const [note, setNote] = useState('');
  const [ack, setAck] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useMemo(() => closureShipmentGuard(order), [order]);
  const allowed = reason ? allowedNotifications(reason, hasEmail) : ['none' as const];
  const paid = order.payment_status === 'paid';
  const external = reason === 'handled_externally';

  function pickReason(next: ClosureReason) {
    setReason(next);
    setError(null);
    const nextAllowed = allowedNotifications(next, hasEmail);
    if (!nextAllowed.includes(notification)) setNotification('none');
    // Pre-filled text follows the reason until the admin edits it.
    if (!messageTouched) setMessage(defaultClosureMessage(next, { firstName, orderNumber, tenantName }));
  }

  const draft = { reason: reason ?? 'other', notification, message, note, shipmentAcknowledged: ack } as const;
  const stepOneIssues = reason ? closureIssues(order, { ...draft, shipmentAcknowledged: true }) : ['Choisissez un motif.'];
  const finalIssues = reason ? closureIssues(order, draft) : stepOneIssues;

  function reset() {
    setStep(1); setReason(null); setNotification('none'); setMessage(''); setMessageTouched(false); setNote(''); setAck(false); setError(null);
  }
  function close() { if (pending) return; reset(); onClose(); }

  async function confirm() {
    if (!reason || finalIssues.length) { setError(finalIssues[0] ?? 'Vérifiez les informations.'); return; }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/orders/${order.id}/close`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, notification, message: notification === 'custom' ? message : null, note: note.trim() || null, shipmentAcknowledged: ack }),
      });
      const body = await response.json().catch(() => null) as { error?: string; closureType?: string; customerNotified?: boolean; alreadyClosed?: boolean } | null;
      if (!response.ok) throw new Error(body?.error ?? 'Clôture impossible.');
      const title = body?.closureType === 'handled_externally' ? 'Commande clôturée : traitée hors plateforme.' : 'Commande annulée.';
      const description = notification === 'none' ? 'Le client n’a pas été notifié.'
        : body?.customerNotified ? 'Le client a été informé par e-mail.'
          : 'L’e-mail au client n’a pas pu partir tout de suite : il sera renvoyé automatiquement.';
      toast.success(title, { description });
      reset();
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clôture impossible.');
    } finally {
      setPending(false);
    }
  }

  async function copyMessage() {
    try { await navigator.clipboard.writeText(message); toast.success('Message copié.'); } catch { toast.error('Copie impossible : sélectionnez le texte.'); }
  }

  const footer = step === 1 ? <>
    <Button variant="secondary" onClick={close}>Annuler</Button>
    <Button onClick={() => { if (stepOneIssues.length) { setError(stepOneIssues[0]!); return; } setError(null); setStep(2); }} disabled={!reason}>Vérifier</Button>
  </> : <>
    <Button variant="secondary" onClick={() => { setError(null); setStep(1); }} disabled={pending}>Retour</Button>
    <Button variant={external ? 'primary' : 'danger'} onClick={() => void confirm()} loading={pending} disabled={finalIssues.length > 0}>
      {external ? 'Clôturer la commande' : 'Annuler la commande'}
    </Button>
  </>;

  return (
    <Dialog open={open} onClose={close} dismissible={!pending} size="lg"
      title={`Clôturer la commande ${orderNumber}`}
      description={`${order.full_name ?? 'Client'} · ${totalLabel} · ${order.fulfillment_type === 'pickup' ? 'Retrait' : 'Livraison'} · ${paymentLabel}`}
      footer={footer}>
      {step === 1 ? (
        <div className="space-y-5">
          {guard.blocked && <InlineAlert tone="danger">{guard.blocked}</InlineAlert>}
          <fieldset className="space-y-2" disabled={Boolean(guard.blocked)}>
            <legend className="mb-1 text-sm font-semibold text-a-text">Que s’est-il passé ?</legend>
            {CLOSURE_REASONS.map((key) => (
              <Choice key={key} name="closure-reason" checked={reason === key} onChange={() => pickReason(key)} title={CLOSURE_REASON_LABELS[key]} hint={CLOSURE_REASON_HINTS[key]} />
            ))}
          </fieldset>
          <FormField label="Note interne" optional={reason !== 'other'} required={reason === 'other'} hint={`Visible uniquement par l’équipe · ${note.length}/${CLOSURE_NOTE_MAX}`}>
            <Textarea rows={2} maxLength={CLOSURE_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ex. client passé en boutique, payera sur place." />
          </FormField>
          <fieldset className="space-y-2" disabled={!reason || Boolean(guard.blocked)}>
            <legend className="mb-1 text-sm font-semibold text-a-text">Informer le client</legend>
            {!hasEmail && <p className="text-xs text-a-text-3">Le client n’a pas d’e-mail : Lepefy ne peut pas le prévenir. Copiez le message pour l’envoyer vous-même (WhatsApp, SMS).</p>}
            {(['none', 'standard', 'custom'] as const).map((key) => {
              const enabled = allowed.includes(key);
              const hint = key === 'standard' ? (external ? 'Non proposée : « Votre commande a été annulée » contredirait une commande finalisée avec la boutique.' : '« Votre commande a été annulée », avec le lien de suivi.')
                : key === 'custom' ? 'Votre texte, envoyé par e-mail avec l’en-tête de la boutique.' : undefined;
              return <Choice key={key} name="closure-notification" checked={notification === key} onChange={() => setNotification(key)} title={CLOSURE_NOTIFICATION_LABELS[key]} hint={hint} disabled={!enabled} />;
            })}
          </fieldset>
          {(notification === 'custom' || (!hasEmail && reason)) && (
            <FormField label="Message au client" required={notification === 'custom'}
              hint={`${message.trim().length}/${CLOSURE_MESSAGE_MAX} caractères · minimum ${CLOSURE_MESSAGE_MIN}${hasEmail ? ` · envoyé à ${order.email}` : ''}`}>
              <Textarea rows={6} maxLength={CLOSURE_MESSAGE_MAX} value={message} onChange={(event) => { setMessage(event.target.value); setMessageTouched(true); }} />
            </FormField>
          )}
          {!hasEmail && reason && <Button variant="secondary" size="sm" onClick={() => void copyMessage()}><IconCopy size={16} aria-hidden="true" /> Copier le message</Button>}
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
      ) : (
        <div className="space-y-4">
          {paid && (
            <InlineAlert tone="warning" title={`Paiement encaissé (${totalLabel}, ${paymentLabel})`}>
              <span className="inline-flex items-start gap-1.5"><IconCreditCard size={16} aria-hidden="true" className="mt-0.5 shrink-0" />Lepefy ne rembourse pas et ne modifie pas le paiement. {external ? 'Le paiement reste celui enregistré sur la plateforme.' : 'Remboursez le client depuis votre prestataire de paiement si nécessaire.'}</span>
            </InlineAlert>
          )}
          {guard.shipmentAck && (
            <div className="space-y-2">
              <InlineAlert tone="warning"><span className="inline-flex items-start gap-1.5"><IconTruck size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{guard.shipmentAck}</span></InlineAlert>
              <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-a-text">
                <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} className="mt-0.5 h-5 w-5 rounded border-a-field accent-a-brand" />
                <span>J’ai traité l’expédition chez le transporteur (ou il n’y a rien à annuler).</span>
              </label>
            </div>
          )}
          <dl className="grid gap-x-4 gap-y-2 rounded-xl border border-a-border bg-a-surface-2 p-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
            <dt className="text-a-text-3">Résultat</dt>
            <dd>{reason && closureTypeFor(reason) === 'handled_externally'
              ? <><Badge tone="info" dot>Traitée hors plateforme</Badge> <span className="text-a-text-2">pas une vente perdue</span></>
              : <><Badge tone="neutral" dot>Annulée</Badge> <span className="text-a-text-2">comptée comme annulation</span></>}</dd>
            <dt className="text-a-text-3">Motif</dt>
            <dd className="text-a-text">{reason ? CLOSURE_REASON_LABELS[reason] : '—'}</dd>
            {note.trim() && <><dt className="text-a-text-3">Note interne</dt><dd className="break-words text-a-text">{note.trim()}</dd></>}
            <dt className="text-a-text-3">Client</dt>
            <dd className="text-a-text">{notification === 'none' ? 'Aucune notification' : notification === 'standard' ? `Notification standard à ${order.email}` : `Message personnalisé à ${order.email}`}</dd>
            {notification === 'custom' && <><dt className="text-a-text-3">Message</dt><dd className="whitespace-pre-wrap break-words text-a-text-2">{message.trim()}</dd></>}
            <dt className="text-a-text-3">Statistiques</dt>
            <dd className="text-a-text-2">{external ? 'Exclue des annulations et du chiffre d’affaires en ligne' : 'Comptée parmi les annulations'}</dd>
          </dl>
          <p className="flex items-start gap-1.5 text-xs text-a-text-3"><IconAlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />La commande ne pourra plus être modifiée. Le stock n’est pas remis en vente automatiquement.</p>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
      )}
    </Dialog>
  );
}
