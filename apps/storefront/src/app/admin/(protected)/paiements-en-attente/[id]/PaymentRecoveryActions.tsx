'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconExternalLink, IconMailForward, IconX } from '@tabler/icons-react';
import ConfirmPaymentButton from '../../../_components/ui/ConfirmPaymentButton';
import ConfirmActionModal from '../../../_components/ui/ConfirmActionModal';

interface Props {
  sessionId: string;
  customerLabel: string;
  resumeLink: string | null;
  initialReminderCount: number;
  initialLastReminderAt: string | null;
  initialNextReminderAt: string | null;
  firstReminderAt: string;
  canResume: boolean;
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
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
    if (!canResume) return { allowed: false, reason: 'Cette demande ne peut plus être reprise.' };
    if (reminderCount >= 2) return { allowed: false, reason: 'Les 2 rappels maximum ont déjà été envoyés.' };
    const now = Date.now();
    const firstAt = new Date(firstReminderAt).getTime();
    if (now < firstAt) return { allowed: false, reason: `Disponible à partir du ${formatDateTime(firstReminderAt)}.` };
    if (nextReminderAt && now < new Date(nextReminderAt).getTime()) {
      return { allowed: false, reason: `Prochain rappel possible le ${formatDateTime(nextReminderAt)}.` };
    }
    return { allowed: true, reason: null };
  }, [canResume, firstReminderAt, nextReminderAt, reminderCount]);

  async function sendReminder() {
    setSendingReminder(true);
    setReminderMessage(null);
    setReminderError(false);
    try {
      const response = await fetch(`/api/admin/checkout-sessions/${sessionId}/reminder`, { method: 'POST' });
      const payload = await response.json().catch(() => ({})) as {
        error?: string;
        reminderCount?: number;
        lastReminderAt?: string | null;
        nextReminderAt?: string | null;
      };
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
        <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-bold text-gray-950 dark:text-white">Relancer le client</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-gray-500 dark:text-gray-400">
                Le message reste prudent : si le client a déjà payé, il lui demande de ne pas payer une seconde fois. Sinon il peut reprendre l’achat et conserver ou changer le moyen de paiement.
              </p>
              <div className="mt-3 text-xs text-gray-500">
                <span className="font-semibold">Rappels envoyés :</span> {reminderCount}/2
                {lastReminderAt && <span> · dernier {formatDateTime(lastReminderAt)}</span>}
              </div>
              {!reminderEligibility.allowed && reminderEligibility.reason && (
                <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">{reminderEligibility.reason}</p>
              )}
              {reminderMessage && (
                <p className={`mt-2 text-sm ${reminderError ? 'text-red-600' : 'text-emerald-700'}`} role="status">
                  {reminderMessage}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => void sendReminder()}
              disabled={sendingReminder || !reminderEligibility.allowed}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 text-sm font-semibold text-violet-700 transition-colors hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-200"
            >
              <IconMailForward size={18} /> {sendingReminder ? 'Envoi…' : 'Envoyer un rappel'}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <h2 className="font-bold text-gray-950 dark:text-white">Reprise client</h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            Le lien sécurisé permet au client de reprendre son achat. Il peut continuer avec le moyen actuel ou en choisir un autre, sans créer de commande tant que le paiement n’est pas confirmé.
          </p>
          {resumeLink && canResume ? (
            <a
              href={resumeLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Ouvrir le lien de reprise client <IconExternalLink size={17} />
            </a>
          ) : (
            <p className="mt-3 text-sm font-medium text-gray-500">Lien de reprise indisponible pour cette demande.</p>
          )}
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-900/60 dark:bg-amber-950/20">
          <h2 className="font-bold text-gray-950 dark:text-white">Décision paiement</h2>
          <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">
            Confirmez uniquement après avoir réellement constaté la réception du paiement externe.
          </p>
          <div className="mt-4 max-w-xs">
            <ConfirmPaymentButton
              endpoint={`/api/admin/checkout-sessions/${sessionId}/confirm-payment`}
              label="Confirmer réception"
              confirmingLabel="Confirmation…"
              className="min-h-11 w-full rounded-xl px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
              style={{ backgroundColor: '#D97706' }}
              onSuccess={(warning) => {
                if (!warning) {
                  router.push('/admin');
                  router.refresh();
                }
              }}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-red-200 bg-white p-5 dark:border-red-900/60 dark:bg-gray-900">
          <h2 className="font-bold text-gray-950 dark:text-white">Zone sensible</h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            Annuler retire la demande de la file. Cela n’annule ni ne rembourse un éventuel paiement déjà effectué chez le prestataire externe.
          </p>
          {cancelError && <p className="mt-2 text-sm text-red-600" role="alert">{cancelError}</p>}
          <button
            type="button"
            onClick={() => setCancelOpen(true)}
            className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
          >
            <IconX size={17} /> Annuler la demande
          </button>
        </section>
      </div>

      <ConfirmActionModal
        open={cancelOpen}
        title="Annuler cette demande de paiement ?"
        description={`La demande de ${customerLabel} sera retirée de la file de vérification. Cette action n’annule ni ne rembourse un éventuel paiement déjà effectué sur le service externe.`}
        confirmLabel="Annuler la demande"
        cancelLabel="Conserver"
        destructive
        loading={cancelling}
        onCancel={() => {
          if (!cancelling) setCancelOpen(false);
        }}
        onConfirm={() => void cancelSession()}
      />
    </>
  );
}
