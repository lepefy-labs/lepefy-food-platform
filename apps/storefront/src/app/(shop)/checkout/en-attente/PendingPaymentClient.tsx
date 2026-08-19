'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCartStore } from '@/stores/cartStore';
import { CheckoutSessionEditor } from '@/components/checkout-session/CheckoutSessionEditor';
import type { Tenant, TenantPaymentMethod } from '@lepefy/types';

// Écran affiché après une demande de paiement via lien externe
// (PayPal/Revolut/autre) — Phase 1, devenu point d'entrée A de l'édition en
// place (checkout_sessions modifiables). sessionStorage ('lepefy-pending-payment',
// écrit par CheckoutForm juste avant la redirection) ne sert plus qu'à
// résoudre sessionId/accessToken sans attendre un aller-retour réseau : tout
// le rendu (montant, moyen de paiement, édition) vient désormais de
// CheckoutSessionEditor, qui relit toujours l'état réel côté serveur
// (GET /api/checkout-sessions/[id]) — jamais les valeurs figées localement,
// qui peuvent être périmées si la session a été modifiée depuis un autre
// onglet/appareil.

interface StoredPendingPayment {
  sessionId:   string;
  accessToken?: string;
}

export default function PendingPaymentClient({
  sessionId: sessionIdFromQuery,
  tenant,
  externalPaymentMethods,
}: {
  sessionId: string | null;
  tenant: Tenant;
  externalPaymentMethods: TenantPaymentMethod[];
}) {
  const [resolved, setResolved] = useState<{ sessionId: string; accessToken?: string } | null | undefined>(undefined);

  useEffect(() => {
    // Le panier n'a de sens que jusqu'ici : la demande de paiement est déjà
    // enregistrée côté serveur, rien ne doit rester bloqué en localStorage.
    // L'éditeur travaille sur la session (server-side), indépendante du
    // panier Zustand courant.
    useCartStore.getState().clearCart();

    const raw = sessionStorage.getItem('lepefy-pending-payment');
    let stored: StoredPendingPayment | null = null;
    if (raw) {
      try {
        stored = JSON.parse(raw) as StoredPendingPayment;
      } catch {
        stored = null;
      }
    }

    if (sessionIdFromQuery && (!stored || stored.sessionId === sessionIdFromQuery)) {
      setResolved({ sessionId: sessionIdFromQuery, accessToken: stored?.accessToken });
    } else if (stored?.sessionId) {
      setResolved({ sessionId: stored.sessionId, accessToken: stored.accessToken });
    } else {
      setResolved(null);
    }
  }, [sessionIdFromQuery]);

  if (resolved === undefined) return null;

  if (resolved === null) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center">
        <h1 className="text-xl font-bold mb-2">Demande de paiement envoyée</h1>
        <p className="text-sm text-gray-500 bg-gray-50 rounded-2xl p-5">
          Votre demande a bien été enregistrée. Consultez vos emails pour le
          récapitulatif, ou contactez la boutique si besoin.
        </p>
        <Link href="/" className="inline-block mt-8 text-sm text-gray-500 hover:text-gray-800">
          ← Retour à la boutique
        </Link>
      </div>
    );
  }

  return (
    <CheckoutSessionEditor
      tenant={tenant}
      externalPaymentMethods={externalPaymentMethods}
      sessionId={resolved.sessionId}
      accessToken={resolved.accessToken}
      onCancelled={() => {
        sessionStorage.removeItem('lepefy-pending-payment');
        window.location.href = '/';
      }}
    />
  );
}
