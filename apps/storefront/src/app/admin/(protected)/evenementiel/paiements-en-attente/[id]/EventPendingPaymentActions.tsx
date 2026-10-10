'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconX } from '@tabler/icons-react';
import ConfirmPaymentButton from '../../../../_components/ui/ConfirmPaymentButton';
import ConfirmDialog from '../../../../_components/ui/ConfirmDialog';

export default function EventPendingPaymentActions({
  requestId,
  customerLabel,
  canConfirm,
  canCancel,
}: {
  requestId: string;
  customerLabel: string;
  canConfirm: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function cancelRequest() {
    if (!canCancel) return;
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

  if (!canConfirm && !canCancel) {
    return (
      <section className="rounded-2xl border border-a-border bg-a-surface p-5 text-sm text-a-text-3">
        Votre rôle permet de consulter ce paiement, mais pas de le confirmer ni de l’annuler.
      </section>
    );
  }

  return (
    <>
      {canConfirm && (
        <section className="rounded-2xl border border-tone-warning-border bg-tone-warning-bg p-5">
          <h2 className="font-bold text-a-text">Paiement externe à vérifier</h2>
          <p className="mt-1 text-sm leading-6 text-a-text-2">Contrôlez d’abord le prestataire externe, puis confirmez uniquement si le paiement est réellement reçu. La réservation et les places ne seront créées qu’après cette validation.</p>
          <div className="mt-4 max-w-sm">
            <ConfirmPaymentButton
              endpoint={`/api/admin/evenementiel/reservation-requests/${requestId}/confirm-payment`}
              label="Vérifier et confirmer"
              confirmingLabel="Confirmation…"
              className="min-h-11 w-full rounded-xl bg-tone-warning-solid px-4 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
              onSuccess={(warning) => {
                if (!warning) {
                  router.push('/admin/evenementiel/reservations');
                  router.refresh();
                }
              }}
            />
          </div>
        </section>
      )}

      {canCancel && (
        <section className="rounded-2xl border border-tone-danger-border bg-a-surface p-5">
          <h2 className="font-bold text-a-text">Zone sensible</h2>
          <p className="mt-1 text-sm leading-6 text-a-text-3">Annuler retire la demande de la file sans créer de réservation. Cela n’annule ni ne rembourse un paiement éventuellement déjà effectué chez PayPal, Revolut ou un autre prestataire.</p>
          {cancelError && <p className="mt-2 text-sm text-tone-danger-fg" role="alert">{cancelError}</p>}
          <button type="button" onClick={() => setCancelOpen(true)} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-tone-danger-border px-4 text-sm font-semibold text-tone-danger-fg hover:bg-tone-danger-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tone-danger-solid"><IconX size={17} /> Annuler la demande</button>
        </section>
      )}

      {canCancel && (
        <ConfirmDialog
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
      )}
    </>
  );
}
