'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { IconExternalLink, IconClock } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { useCartStore } from '@/stores/cartStore';

// Écran affiché après une demande de paiement via lien externe
// (PayPal/Revolut/autre) — Phase 1. Volontairement AUCUN numéro de commande
// ici : rien n'est encore commandé, seule une checkout_session en attente de
// confirmation manuelle admin existe. Les détails (lien, montant, libellé)
// viennent de sessionStorage, écrits par CheckoutForm juste avant la
// redirection — la page ne relit jamais checkout_sessions (pas de policy
// publique sur cette table, service_role uniquement).

interface PendingPaymentData {
  sessionId: string;
  link:      string;
  amount:    number;
  currency:  string;
  isPaypal:  boolean;
  label:     string;
}

export default function PendingPaymentClient({
  sessionId,
  currency,
}: {
  sessionId: string | null;
  currency:  string;
}) {
  const [data, setData] = useState<PendingPaymentData | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Le panier n'a de sens que jusqu'ici : la demande de paiement est déjà
    // enregistrée côté serveur, rien ne doit rester bloqué en localStorage.
    useCartStore.getState().clearCart();

    const raw = sessionStorage.getItem('lepefy-pending-payment');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as PendingPaymentData;
        if (!sessionId || parsed.sessionId === sessionId) setData(parsed);
      } catch {
        // ignore — fallback générique ci-dessous
      }
    }
    setHydrated(true);
  }, [sessionId]);

  if (!hydrated) return null;

  return (
    <div className="max-w-md mx-auto px-4 py-10 text-center">
      <div className="w-14 h-14 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
        <IconClock size={28} />
      </div>

      <h1 className="text-xl font-bold mb-2">Demande de paiement envoyée</h1>
      <p className="text-sm text-gray-500 mb-6">
        Ceci n&apos;est pas encore une commande confirmée — elle le sera dès que
        votre paiement aura été vérifié.
      </p>

      {data ? (
        <div className="bg-gray-50 rounded-2xl p-5 text-left space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Moyen choisi</span>
            <span className="text-sm font-semibold">{data.label}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-500">Montant à envoyer</span>
            <span className="text-lg font-bold">{formatPrice(data.amount, data.currency)}</span>
          </div>

          <a
            href={data.link}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-white text-sm"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            Ouvrir {data.label} <IconExternalLink size={16} />
          </a>

          {data.isPaypal ? (
            <p className="text-xs text-gray-500">
              Sélectionnez « Amis et famille » lors du paiement pour éviter les frais.
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              Le montant n&apos;est pas prérempli sur ce lien — saisissez-le
              manuellement : <strong>{formatPrice(data.amount, data.currency)}</strong>.
            </p>
          )}

          <p className="text-xs text-gray-400 border-t border-gray-200 pt-3">
            Une fois votre paiement reçu et vérifié, la boutique confirmera
            votre commande — vous recevrez un email de confirmation.
          </p>
        </div>
      ) : (
        <p className="text-sm text-gray-500 bg-gray-50 rounded-2xl p-5">
          Votre demande a bien été enregistrée. Consultez vos emails pour le
          récapitulatif, ou contactez la boutique si besoin.
        </p>
      )}

      <Link href="/" className="inline-block mt-8 text-sm text-gray-500 hover:text-gray-800">
        ← Retour à la boutique
      </Link>
    </div>
  );
}
