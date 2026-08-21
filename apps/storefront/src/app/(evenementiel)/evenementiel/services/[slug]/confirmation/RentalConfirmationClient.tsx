'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { IconCalendar, IconCircleCheck, IconClock } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

interface StatusResponse {
  found: boolean;
  reservation?: { id: string; customer_name: string; pickup_date: string; amount_paid: number };
  offering?: { title: string };
  items?: { quantity: number; unit_price: number; rental_items: { name: string } | null }[];
}

export default function RentalConfirmationClient({ paymentIntentId }: { paymentIntentId: string | null }) {
  const [data, setData] = useState<StatusResponse | null>(null);
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
        // Retry at next interval.
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
      <main className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-amber-100 text-amber-700"><IconClock size={28} /></div>
        <h1 className="mt-5 font-display text-3xl font-semibold text-gray-900">Réservation en cours de traitement</h1>
        <Link href="/evenementiel" className="mt-6 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-[var(--color-primary)]">← Retour</Link>
      </main>
    );
  }

  if (timedOut && !data?.found) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-green-100 text-green-700"><IconCircleCheck size={30} /></div>
        <h1 className="mt-5 font-display text-3xl font-semibold text-gray-900">Merci pour votre réservation.</h1>
        <p className="mt-3 text-sm text-gray-600">Votre paiement a été reçu. Vérifiez votre email pour la confirmation.</p>
        <Link href="/evenementiel" className="mt-6 inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-[var(--color-primary)]">← Retour</Link>
      </main>
    );
  }

  if (!data?.found) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6" aria-live="polite">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-amber-100 text-amber-700 motion-safe:animate-pulse"><IconClock size={28} /></div>
        <h1 className="mt-5 font-display text-3xl font-semibold text-gray-900">Paiement reçu, réservation en cours</h1>
        <p className="mt-3 text-sm text-gray-600">Nous finalisons votre confirmation.</p>
      </main>
    );
  }

  const { reservation, offering, items } = data;

  return (
    <main className="mx-auto max-w-xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-green-100 text-green-700"><IconCircleCheck size={30} /></div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-green-700">Réservation confirmée</p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-gray-900 sm:text-4xl">Votre matériel est réservé.</h1>
        {offering && <p className="mt-2 text-sm text-gray-500">{offering.title}</p>}
      </div>

      <section className="mt-8 rounded-3xl border border-black/[0.06] bg-white p-5 shadow-[0_18px_45px_rgba(50,37,20,.08)] sm:p-6">
        {reservation && (
          <div className="flex items-start gap-3 rounded-2xl bg-[#f7f3eb] p-4">
            <IconCalendar size={18} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
            <div><p className="text-xs text-gray-500">Date de retrait</p><p className="mt-1 text-sm font-semibold text-gray-900">{new Date(reservation.pickup_date).toLocaleDateString('fr-FR')}</p></div>
          </div>
        )}

        <div className="mt-5 divide-y divide-black/[0.06]">
          {(items ?? []).map((item, index) => (
            <div key={index} className="flex justify-between gap-4 py-3 text-sm">
              <span className="min-w-0 text-gray-600">{item.rental_items?.name ?? 'Article'} × {item.quantity}</span>
              <span className="shrink-0 font-semibold text-gray-900">{formatPrice(item.unit_price * item.quantity, 'EUR')}</span>
            </div>
          ))}
        </div>
        {reservation && (
          <div className="mt-3 flex justify-between border-t border-black/[0.08] pt-4 text-base font-bold"><span>Total</span><span>{formatPrice(reservation.amount_paid, 'EUR')}</span></div>
        )}
        {reservation && <p className="mt-4 text-xs text-gray-400">Réf. #{reservation.id.slice(0, 8).toUpperCase()}</p>}
      </section>

      <div className="mt-7 text-center"><Link href="/evenementiel" className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-[var(--color-primary)] hover:bg-white">← Retour aux services</Link></div>
    </main>
  );
}
