'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconExternalLink, IconMailForward, IconX } from '@tabler/icons-react';
import ConfirmPaymentButton from '../../../_components/ui/ConfirmPaymentButton';
import ConfirmDialog from '../../../_components/ui/ConfirmDialog';

interface Props {
  sessionId: string;
  customerLabel: string;
  resumeLink: string | null;
  initialReminderCount: number;
  initialLastReminderAt: string | null;
  initialNextReminderAt: string | null;
  firstReminderAt: string;
  canResume: boolean;
  canManageSession: boolean;
  canConfirmPayment: boolean;
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

export default function PaymentRecoveryActions({
  sessionId,
  customerLabel,
  resumeLink,
  initialReminderCount,
  initialLastReminderAt,
  initialNextReminderAt,
  firstReminderAt,
  canResume,
  canManageSession,
  canConfirmPayment,
}: Props) {
  const router = useRouter();
  const [reminderCount, setReminderCount] = useState(initialReminderCount);
  const [lastReminderAt, setLastReminderAt] = useState(initialLastReminderAt);
  const [nextReminderAt, setNextReminderAt] = useState(initialNextReminderAt);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [reminderMessage, setReminderMessage] = useState<string | null>(null);
  const [reminderError, setReminderError] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const reminderEligibility = useMemo(() => {
    if (!canManageSession) return { allowed: false, reason: 'Votre rôle ne permet pas d’envoyer des rappels.' };
    if (!canResume) return { allowed: false, reason: 'Cette demande ne peut plus être reprise.' };
    if (reminderCount >= 2) return { allowed: false, reason: 'Les 2 rappels maximum ont déjà été envoyés.' };
    const now = Date.now();
    const firstAt = new Date(firstReminderAt).getTime();
    if (now < firstAt) return { allowed: false, reason: `Disponible à partir du ${formatDateTime(firstReminderAt)}.` };
    if (nextReminderAt && now < new Date(nextReminderAt).getTime()) return { allowed: false, reason: `Prochain rappel possible le ${formatDateTime(nextReminderAt)}.` };
    return { allowed: true, reason: null };
  }, [canManageSession, canResume, firstReminderAt, nextReminderAt, reminderCount]);

  async function sendReminder() {
    if (!canManageSession) return;
    setSendingReminder(true);
    setReminderMessage(null);
    setReminderError(false);
    try {
      const response = await fetch(`/api/admin/checkout-sessions/${sessionId}/reminder`, { method: 'POST' });
      const payload = await response.json().catch(() => ({})) as { error?: string; reminderCount?: number; lastReminderAt?: string | null; nextReminderAt?: string | null };
      if (!response.ok) {
        setReminderError(true);
        setReminderMessage(payload.error ?? 'Impossible d’envoyer le rappel.');
        if (payload.nextReminderAt) setNextReminderAt(payload.nextReminderAt);
        return;
      }
      setReminderCount(payload.reminderCount ?? reminderCount + 1);
      setLastReminderAt(payload.lastReminderAt ?? new Date().toISOString());
      setNextReminderAt(payload.nextReminderAt ?? null);
      setReminderMessage('Rappel envoyé au client.');
      router.refresh();
    } catch {
      setReminderError(true);
      setReminderMessage('Impossible d’envoyer le rappel.');
    } finally {
      setSendingReminder(false);
    }
  }

  async function cancelSession() {
    if (!canManageSession) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const response = await fetch(`/api/admin/checkout-sessions/${sessionId}/cancel`, { method: 'POST' });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setCancelError(payload.error ?? 'Impossible d’annuler cette demande.');
        return;
      }
      setCancelOpen(false);
      router.push('/admin');
      router.refresh();
    } catch {
      setCancelError('Impossible d’annuler cette demande.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <div className="space-y-4">
        <section className="rounded-2xl border border-a-border bg-a-surface p-5 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-bold text-a-text">Relancer le client</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-a-text-3">Le message reste prudent : si le client a déjà payé, il lui demande de ne pas payer une seconde fois. Sinon il peut reprendre l’achat et conserver ou changer le moyen de paiement.</p>
              <div className="mt-3 text-xs text-a-text-3"><span className="font-semibold">Rappels envoyés :</span> {reminderCount}/2{lastReminderAt && <span> · dernier {formatDateTime(lastReminderAt)}</span>}</div>
              {!reminderEligibility.allowed && reminderEligibility.reason && <p className="mt-2 text-xs font-medium text-tone-warning-fg">{reminderEligibility.reason}</p>}
              {reminderMessage && <p className={`mt-2 text-sm ${reminderError ? 'text-tone-danger-fg' : 'text-tone-success-fg'}`} role="status">{reminderMessage}</p>}
            </div>
            {canManageSession && (
              <button type="button" onClick={() => void sendReminder()} disabled={sendingReminder || !reminderEligibility.allowed} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-a-border bg-a-brand-soft px-4 text-sm font-semibold text-a-brand-fg transition-colors hover:bg-a-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-brand disabled:cursor-not-allowed disabled:opacity-50"><IconMailForward size={18} /> {sendingReminder ? 'Envoi…' : 'Envoyer un rappel'}</button>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-a-border bg-a-surface p-5 shadow-sm">
          <h2 className="font-bold text-a-text">Reprise client</h2>
          <p className="mt-1 text-sm leading-6 text-a-text-3">Le lien sécurisé permet au client de reprendre son achat. Il peut continuer avec le moyen actuel ou en choisir un autre, sans créer de commande tant que le paiement n’est pas confirmé.</p>
          {resumeLink && canResume ? <a href={resumeLink} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-a-border-strong bg-a-surface px-4 text-sm font-semibold text-a-text-2 hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-border-strong">Ouvrir le lien de reprise client <IconExternalLink size={17} /></a> : <p className="mt-3 text-sm font-medium text-a-text-3">Lien de reprise indisponible pour cette demande.</p>}
        </section>

        {canConfirmPayment ? (
          <section className="rounded-2xl border border-tone-warning-border bg-tone-warning-bg p-5">
            <h2 className="font-bold text-a-text">Décision paiement</h2>
            <p className="mt-1 text-sm leading-6 text-a-text-2">Confirmez uniquement après avoir réellement constaté la réception du paiement externe.</p>
            <div className="mt-4 max-w-xs"><ConfirmPaymentButton endpoint={`/api/admin/checkout-sessions/${sessionId}/confirm-payment`} label="Confirmer réception" confirmingLabel="Confirmation…" style={{ backgroundColor: '#D97706' }} onSuccess={(warning) => { if (!warning) { router.push('/admin'); router.refresh(); } }} /></div>
          </section>
        ) : (
          <section className="rounded-2xl border border-a-border bg-a-surface p-5 text-sm text-a-text-3">Votre rôle permet de consulter cette demande, mais pas de confirmer manuellement un paiement externe.</section>
        )}

        {canManageSession && (
          <section className="rounded-2xl border border-tone-danger-border bg-a-surface p-5">
            <h2 className="font-bold text-a-text">Zone sensible</h2>
            <p className="mt-1 text-sm leading-6 text-a-text-3">Annuler retire la demande de la file. Cela n’annule ni ne rembourse un éventuel paiement déjà effectué chez le prestataire externe.</p>
            {cancelError && <p className="mt-2 text-sm text-tone-danger-fg" role="alert">{cancelError}</p>}
            <button type="button" onClick={() => setCancelOpen(true)} className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-tone-danger-border px-4 text-sm font-semibold text-tone-danger-fg hover:bg-tone-danger-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tone-danger-solid"><IconX size={17} /> Annuler la demande</button>
          </section>
        )}
      </div>

      {canManageSession && <ConfirmDialog open={cancelOpen} title="Annuler cette demande de paiement ?" description={`La demande de ${customerLabel} sera retirée de la file de vérification. Cette action n’annule ni ne rembourse un éventuel paiement déjà effectué sur le service externe.`} confirmLabel="Annuler la demande" cancelLabel="Conserver" destructive loading={cancelling} onCancel={() => { if (!cancelling) setCancelOpen(false); }} onConfirm={() => void cancelSession()} />}
    </>
  );
}
