'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconX } from '@tabler/icons-react';
import ConfirmPaymentButton from '../../../../_components/ui/ConfirmPaymentButton';
import ConfirmActionModal from '../../../../_components/ui/ConfirmActionModal';

export default function EventPendingPaymentActions({ requestId, customerLabel }: { requestId: string; customerLabel: string }) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function cancelRequest() {
    setCancelling(true);
    setCancelError(null);
    try {
      const response = await fetch(`/api/admin/evenementiel/reservation-requests/${requestId}/cancel`, { method: 'POST' });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setCancelError(payload.error ?? 'Impossible d’annuler cette demande.');
        return;
      }
      setCancelOpen(false);
      router.push('/admin/evenementiel/reservations');
      router.refresh();
    } catch {
      setCancelError('Impossible d’annuler cette demande.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <>
      <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 dark:border-amber-900/60 dark:bg-amber-950/20">
        <h2 className="font-bold text-gray-950 dark:text-white">Décision paiement</h2>
        <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">Confirmez uniquement après avoir réellement constaté la réception du paiement externe. La réservation sera créée à ce moment-là seulement.</p>
        <div className="mt-4 max-w-sm">
          <ConfirmPaymentButton
            endpoint={`/api/admin/evenementiel/reservation-requests/${requestId}/confirm-payment`}
            label="Confirmer réception"
            confirmingLabel="Confirmation…"
            className="min-h-11 w-full rounded-xl bg-amber-600 px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            onSuccess={(warning) => {
              if (!warning) {
                router.push('/admin/evenementiel/reservations');
                router.refresh();
              }
            }}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-red-200 bg-white p-5 dark:border-red-900/60 dark:bg-gray-900">
        <h2 className="font-bold text-gray-950 dark:text-white">Zone sensible</h2>
        <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">Annuler retire la demande de la file sans créer de réservation. Cela n’annule ni ne rembourse un paiement éventuellement déjà effectué chez PayPal, Revolut ou un autre prestataire.</p>
        {cancelError && <p className="mt-2 text-sm text-red-600" role="alert">{cancelError}</p>}
        <button type="button" onClick={() => setCancelOpen(true)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"><IconX size={17} /> Annuler la demande</button>
      </section>

      <ConfirmActionModal
        open={cancelOpen}
        title="Annuler cette demande de paiement ?"
        description={`La demande de ${customerLabel} sera retirée de la file. Aucun remboursement n’est effectué chez le prestataire externe.`}
        confirmLabel="Annuler la demande"
        cancelLabel="Conserver"
        destructive
        loading={cancelling}
        onCancel={() => { if (!cancelling) setCancelOpen(false); }}
        onConfirm={() => void cancelRequest()}
      />
    </>
  );
}
