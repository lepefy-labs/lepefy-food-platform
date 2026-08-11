'use client';

import { useState } from 'react';

// Bouton de confirmation de paiement, partagé entre deux contextes :
//  - mode "in_store": PATCH /api/admin/orders/[id] — commande déjà créée,
//    on ne fait que passer payment_status à "paid" (comportement inchangé).
//  - mode "external_link": POST /api/admin/checkout-sessions/[id]/confirm-payment
//    — aucune commande n'existe encore, elle est créée à la confirmation
//    (voir createOrderFromCheckoutSession). Un conflit de stock détecté à ce
//    moment-là remonte comme `warning` (aucun remboursement automatique
//    possible pour ce moyen de paiement).

interface ConfirmPaymentButtonProps {
  mode: 'in_store' | 'external_link';
  id: string;
  label: string;
  confirmingLabel: string;
  onSuccess?: (warning?: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export default function ConfirmPaymentButton({
  mode,
  id,
  label,
  confirmingLabel,
  onSuccess,
  className,
  style,
}: ConfirmPaymentButtonProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleClick() {
    setLoading(true);
    setMessage(null);
    setIsError(false);
    try {
      const res =
        mode === 'in_store'
          ? await fetch(`/api/admin/orders/${id}`, {
              method:  'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ payment_status: 'paid' }),
            })
          : await fetch(`/api/admin/checkout-sessions/${id}/confirm-payment`, {
              method: 'POST',
            });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setMessage(body?.error ?? 'Erreur lors de la mise à jour.');
        setIsError(true);
        return;
      }

      if (body?.warning) {
        setMessage(body.warning);
        setIsError(true);
      }

      onSuccess?.(body?.warning);
    } catch {
      setMessage('Erreur lors de la mise à jour.');
      setIsError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className={className ?? 'w-full py-2.5 rounded-lg font-semibold text-white text-sm disabled:opacity-50 transition-opacity'}
        style={style ?? { backgroundColor: '#D97706' }}
      >
        {loading ? confirmingLabel : label}
      </button>
      {message && (
        <p className={`text-sm mt-2 ${isError ? 'text-red-600' : 'text-green-700'}`}>
          {message}
        </p>
      )}
    </div>
  );
}
