'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { IconClock, IconCircleCheck, IconCalendarEvent, IconMapPin } from '@tabler/icons-react';
import { formatDate, formatPrice } from '@/lib/utils/format';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS  = 30000;

interface StatusResponse {
  found: boolean;
  reservation?: {
    id: string;
    customer_name: string;
    amount_paid: number;
    qr_token: string;
    quantity_total: number;
  };
  event?: {
    title: string;
    date_start: string;
    location: string | null;
  };
}

export default function EventConfirmationClient({ paymentIntentId }: { paymentIntentId: string | null }) {
  const [data, setData]         = useState<StatusResponse | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!paymentIntentId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/events/reservation-status?payment_intent=${paymentIntentId}`);
        const json: StatusResponse = await res.json();
        if (json.found) {
          setData(json);
          clearInterval(interval);
        }
      } catch {
        // Confort — on retente au prochain intervalle.
      }
    }, POLL_INTERVAL_MS);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      setTimedOut(true);
    }, POLL_TIMEOUT_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [paymentIntentId]);

  if (!paymentIntentId) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-bold mb-2">Réservation en cours de traitement</h1>
        <Link href="/evenementiel" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Retour aux événements
        </Link>
      </div>
    );
  }

  if (timedOut && !data?.found) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <IconCircleCheck size={28} className="text-green-600" />
        </div>
        <h1 className="text-xl font-bold mb-2">Merci pour votre réservation !</h1>
        <p className="text-sm text-gray-500 mb-6">
          Votre paiement a bien été reçu. Vérifiez votre email pour recevoir votre billet.
        </p>
        <Link href="/evenementiel" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Retour aux événements
        </Link>
      </div>
    );
  }

  if (!data?.found) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-4 animate-pulse">
          <IconClock size={28} className="text-yellow-700" />
        </div>
        <h1 className="text-xl font-bold mb-2">Paiement reçu — réservation en cours</h1>
        <p className="text-sm text-gray-500">Votre billet est en cours de génération…</p>
      </div>
    );
  }

  const { reservation, event } = data;

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <div className="text-center mb-6">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <IconCircleCheck size={28} className="text-green-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Réservation confirmée !</h1>
        <p className="text-sm text-gray-500">Présentez ce QR code à l&apos;entrée de l&apos;événement.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center mb-4">
        {event && (
          <>
            <p className="font-bold text-gray-900 mb-1">{event.title}</p>
            <p className="text-xs text-gray-500 flex items-center justify-center gap-1.5 mb-1">
              <IconCalendarEvent size={13} /> {formatDate(event.date_start)}
            </p>
            {event.location && (
              <p className="text-xs text-gray-500 flex items-center justify-center gap-1.5 mb-4">
                <IconMapPin size={13} /> {event.location}
              </p>
            )}
          </>
        )}

        {reservation && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/events/reservation-qr?token=${encodeURIComponent(reservation.qr_token)}`}
              alt="QR code d'entrée"
              className="mx-auto w-56 h-56"
            />
            <p className="text-sm font-semibold text-gray-900 mt-4">{reservation.customer_name}</p>
            <p className="text-xs text-gray-500">
              {reservation.quantity_total} place{reservation.quantity_total > 1 ? 's' : ''} — {formatPrice(reservation.amount_paid, 'EUR')}
            </p>
          </>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center mb-6">
        Un email de confirmation avec votre billet a été envoyé.
      </p>

      <div className="text-center">
        <Link href="/evenementiel" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Retour aux événements
        </Link>
      </div>
    </div>
  );
}
