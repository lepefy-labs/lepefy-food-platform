'use client';

import { useState } from 'react';

// Bouton de confirmation de paiement, générique — un seul point de vérité
// pour tous les contextes "confirmer réception d'un paiement en attente"
// (Phase 1 boutique, Phase 2 billetterie, et modules futurs) : le composant
// ne connaît ni "commande" ni "réservation", seulement un endpoint HTTP à
// appeler. Généralisé en Phase 2 (props `mode`/`id` figées trop shop-
// spécifiques) plutôt que dupliqué pour la billetterie.
//
// Réponse attendue : { warning?: string } en cas de succès partiel (ex.
// stock_conflict — aucun remboursement automatique possible pour ce moyen de
// paiement, l'admin doit le gérer manuellement), { error: string } sinon.

interface ConfirmPaymentButtonProps {
  endpoint: string;
  method?: 'POST' | 'PATCH';
  body?: Record<string, unknown>;
  label: string;
  confirmingLabel: string;
  onSuccess?: (warning?: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export default function ConfirmPaymentButton({
  endpoint,
  method = 'POST',
  body,
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
      const res = await fetch(endpoint, {
        method,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });

      const responseBody = await res.json().catch(() => null);

      if (!res.ok) {
        setMessage(responseBody?.error ?? 'Erreur lors de la mise à jour.');
        setIsError(true);
        return;
      }

      if (responseBody?.warning) {
        setMessage(responseBody.warning);
        setIsError(true);
      }

      onSuccess?.(responseBody?.warning);
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
