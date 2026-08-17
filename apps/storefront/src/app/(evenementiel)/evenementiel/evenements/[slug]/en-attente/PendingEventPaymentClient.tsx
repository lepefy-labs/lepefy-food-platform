'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconExternalLink, IconClock, IconBrandWhatsapp } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';

// Même comportement que (shop)/checkout/en-attente (Phase 1) : aucune
// réservation confirmée ici, seulement une demande event_reservation_requests
// en attente — les détails viennent de sessionStorage, écrits par
// EventCheckoutClient juste avant la redirection (la page ne relit jamais
// event_reservation_requests, pas de policy publique sur cette table).

interface PendingEventPaymentData {
  requestId:     string;
  link:          string;
  amount:        number;
  currency:      string;
  isPaypal:      boolean;
  label:         string;
  customerEmail: string;
  eventSlug:     string;
}

interface Props {
  requestId:      string | null;
  whatsappNumber: string | null;
}

export default function PendingEventPaymentClient({ requestId, whatsappNumber }: Props) {
  const router = useRouter();
  const [data, setData] = useState<PendingEventPaymentData | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [changingMethod, setChangingMethod] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('lepefy-pending-event-payment');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as PendingEventPaymentData;
        if (!requestId || parsed.requestId === requestId) setData(parsed);
      } catch {
        // ignore — fallback générique ci-dessous
      }
    }
    setHydrated(true);
  }, [requestId]);

  async function handleChangePaymentMethod() {
    if (!data) return;
    setChangingMethod(true);
    setChangeError(null);
    try {
      const res = await fetch(`/api/events/reservation-requests/${data.requestId}`, { method: 'DELETE' });
      if (res.status === 409) {
        setChangeError('Votre paiement a déjà été confirmé entre-temps. Vérifiez vos emails.');
        return;
      }
      if (!res.ok) {
        setChangeError('Une erreur est survenue. Réessayez.');
        return;
      }
      router.push(`/evenementiel/evenements/${data.eventSlug}`);
    } finally {
      setChangingMethod(false);
    }
  }

  if (!hydrated) return null;

  return (
    <div className="max-w-md mx-auto px-4 py-10 text-center">
      <div className="w-14 h-14 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
        <IconClock size={28} />
      </div>

      <h1 className="text-xl font-bold mb-2">Demande de paiement envoyée</h1>
      <p className="text-sm text-gray-500 mb-6">
        Ceci n&apos;est pas encore une réservation confirmée : elle le sera dès que
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

          <button
            type="button"
            onClick={handleChangePaymentMethod}
            disabled={changingMethod}
            className="w-full text-sm font-semibold text-gray-500 hover:text-gray-800 disabled:opacity-50"
          >
            {changingMethod ? 'Changement en cours…' : 'Changer de moyen de paiement'}
          </button>

          {changeError && <p className="text-xs text-red-500">{changeError}</p>}

          {data.isPaypal ? (
            <p className="text-xs text-gray-500">
              Sélectionnez « Amis et famille » lors du paiement pour éviter les frais.
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              Le montant n&apos;est pas prérempli sur ce lien, saisissez-le
              manuellement : <strong>{formatPrice(data.amount, data.currency)}</strong>.
            </p>
          )}

          <div className="text-xs text-gray-500 border-t border-gray-200 pt-3 space-y-2 text-left">
            <p>
              Votre billet vous sera envoyé par email à{' '}
              <strong className="text-gray-700">{data.customerEmail}</strong> dès que
              votre paiement sera vérifié par l&apos;organisateur.
            </p>
            <p>
              Pour ce moyen de paiement, l&apos;email est le seul moyen de recevoir
              votre billet : il n&apos;y a pas de page de téléchargement, contrairement
              au paiement par carte. Vérifiez que l&apos;adresse ci-dessus est correcte
              avant d&apos;effectuer le paiement.
            </p>
            {whatsappNumber && (
              <a
                href={`https://wa.me/${whatsappNumber.replace(/[^0-9]/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold hover:underline"
                style={{ color: 'var(--color-primary)' }}
              >
                <IconBrandWhatsapp size={14} /> Une erreur dans votre email ? Contactez-nous avant d&apos;effectuer le paiement.
              </a>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-500 bg-gray-50 rounded-2xl p-5">
          Votre demande a bien été enregistrée. Consultez vos emails pour le
          récapitulatif, ou contactez l&apos;organisateur si besoin.
        </p>
      )}

      <Link href="/evenementiel" className="inline-block mt-8 text-sm text-gray-500 hover:text-gray-800">
        ← Retour aux événements
      </Link>
    </div>
  );
}
