'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { IconClock, IconCircleCheck, IconCalendar } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS  = 30000;

interface StatusResponse {
  found: boolean;
  reservation?: { id: string; customer_name: string; pickup_date: string; amount_paid: number };
  offering?: { title: string };
  items?: { quantity: number; unit_price: number; rental_items: { name: string } | null }[];
}

export default function RentalConfirmationClient({ paymentIntentId }: { paymentIntentId: string | null }) {
  const [data, setData]         = useState<StatusResponse | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!paymentIntentId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/rental/reservation-status?payment_intent=${paymentIntentId}`);
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
          ← Retour
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
        <p className="text-sm text-gray-500 mb-6">Vérifiez votre email pour la confirmation.</p>
        <Link href="/evenementiel" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Retour
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
      </div>
    );
  }

  const { reservation, offering, items } = data;

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <div className="text-center mb-6">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <IconCircleCheck size={28} className="text-green-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Réservation confirmée !</h1>
        {offering && <p className="text-sm text-gray-500">{offering.title}</p>}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
        {reservation && (
          <p className="text-sm text-gray-700 flex items-center gap-1.5 mb-3">
            <IconCalendar size={14} /> Retrait le {new Date(reservation.pickup_date).toLocaleDateString('fr-FR')}
          </p>
        )}
        <div className="space-y-1.5">
          {(items ?? []).map((item, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-gray-600">{item.rental_items?.name ?? 'Article'} × {item.quantity}</span>
              <span className="font-medium">{formatPrice(item.unit_price * item.quantity, 'EUR')}</span>
            </div>
          ))}
        </div>
        {reservation && (
          <div className="flex justify-between font-bold text-base border-t border-gray-100 pt-2 mt-2">
            <span>Total</span>
            <span>{formatPrice(reservation.amount_paid, 'EUR')}</span>
          </div>
        )}
      </div>

      <div className="text-center">
        <Link href="/evenementiel" className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          ← Retour
        </Link>
      </div>
    </div>
  );
}
