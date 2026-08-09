'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { IconClock, IconCircleCheck, IconCalendarEvent, IconMapPin, IconCalendarPlus, IconDownload } from '@tabler/icons-react';
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
    quantity_remaining: number;
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

  // Fichier .ics généré côté client — aucune dépendance, même approche
  // blob+download que les exports admin.
  function addToCalendar() {
    if (!event || !reservation) return;
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
      `SUMMARY:${event.title}`,
      event.location ? `LOCATION:${event.location.replace(/,/g, '\\,')}` : '',
      `DTSTART:${new Date(event.date_start).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DESCRIPTION:Réf. #${reservation.id.slice(0, 8).toUpperCase()} — ${reservation.quantity_total} place(s)`,
      'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.title.replace(/\s+/g, '-').toLowerCase()}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const remaining = reservation?.quantity_remaining ?? 0;

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <div className="text-center mb-8">
        <div
          className="w-[84px] h-[84px] rounded-full mx-auto mb-5 flex items-center justify-center no-print"
          style={{
            background: `radial-gradient(circle, #fff 0%, var(--color-primary-light) 70%)`,
            boxShadow: `0 0 0 8px color-mix(in srgb, var(--color-primary) 8%, transparent), 0 10px 24px color-mix(in srgb, var(--color-primary) 18%, transparent)`,
          }}
        >
          <IconCircleCheck size={36} style={{ color: 'var(--color-primary)' }} strokeWidth={1.8} />
        </div>
        <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-primary)' }}>
          Billet numérique
        </p>
        <h1 className="font-display text-3xl font-bold text-gray-900 mb-2">Réservation confirmée !</h1>
        <p className="text-[15px] text-gray-500">Présentez ce QR code à l&apos;entrée de l&apos;événement.</p>
      </div>

      <div className="bg-white rounded-[20px] border border-gray-100 shadow-[0_2px_4px_rgba(17,24,39,0.04),0_20px_40px_-12px_rgba(17,24,39,0.16)] print:shadow-none overflow-hidden">
        {event && (
          <div className="px-7 pt-7 pb-6 text-center bg-gradient-to-b from-gray-50 to-white">
            <p className="font-display font-bold text-lg text-gray-900 mb-2">{event.title}</p>
            <p className="flex items-center justify-center gap-1.5 text-[13.5px] font-semibold mb-1" style={{ color: 'var(--color-primary)' }}>
              <IconCalendarEvent size={14} /> {formatDate(event.date_start)}
            </p>
            {event.location && (
              <p className="flex items-center justify-center gap-1.5 text-[13.5px] font-semibold" style={{ color: 'var(--color-primary)' }}>
                <IconMapPin size={14} /> {event.location}
              </p>
            )}
          </div>
        )}

        {/* perforation */}
        <div className="relative h-0">
          <div className="absolute -left-[11px] -top-[11px] w-[22px] h-[22px] rounded-full bg-gray-50" />
          <div className="absolute -right-[11px] -top-[11px] w-[22px] h-[22px] rounded-full bg-gray-50" />
          <div className="border-t-[1.5px] border-dashed border-gray-200 mx-6" />
        </div>

        {reservation && (
          <div className="px-7 py-8 text-center">
            <div
              className="relative w-56 h-56 mx-auto mb-5 p-3.5 rounded-2xl"
              style={{ background: 'var(--color-primary-light)' }}
            >
              <span
                className="absolute -top-2.5 -right-2.5 text-[10px] font-bold text-white px-2.5 py-1 rounded-full z-10"
                style={{ background: 'var(--color-primary)', boxShadow: `0 2px 6px color-mix(in srgb, var(--color-primary) 35%, transparent)` }}
              >
                {remaining} SCAN{remaining > 1 ? 'S' : ''} VALIDE{remaining > 1 ? 'S' : ''}
              </span>
              {(['top-2 left-2 border-t-2 border-l-2 rounded-tl', 'top-2 right-2 border-t-2 border-r-2 rounded-tr',
                 'bottom-2 left-2 border-b-2 border-l-2 rounded-bl', 'bottom-2 right-2 border-b-2 border-r-2 rounded-br'] as const)
                .map((cls) => (
                  <span key={cls} className={`absolute w-[18px] h-[18px] ${cls}`} style={{ borderColor: 'var(--color-primary)' }} />
                ))}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/events/reservation-qr?token=${encodeURIComponent(reservation.qr_token)}`}
                alt="QR code d'entrée"
                className="w-full h-full object-contain"
              />
            </div>
            <p className="text-[15px] font-bold text-gray-900 mb-1">{reservation.customer_name}</p>
            <p className="text-[13px] text-gray-500 mb-4">
              {reservation.quantity_total} place{reservation.quantity_total > 1 ? 's' : ''} — {formatPrice(reservation.amount_paid, 'EUR')}
            </p>
            <p className="text-[11px] font-mono tracking-wide text-gray-500">
              RÉF. #{reservation.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
        )}
      </div>

      <div className="no-print flex flex-wrap gap-3 mt-6">
        <button
          onClick={addToCalendar}
          className="flex-1 min-w-[190px] h-12 rounded-xl border-[1.5px] border-gray-300 bg-white text-sm font-semibold text-gray-900 flex items-center justify-center gap-2 hover:bg-gray-50 transition-colors"
        >
          <IconCalendarPlus size={16} /> Ajouter au calendrier
        </button>
        <button
          onClick={() => window.print()}
          className="flex-1 min-w-[190px] h-12 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 hover:-translate-y-px transition-transform"
          style={{ background: 'var(--color-primary)' }}
        >
          <IconDownload size={16} /> Télécharger le billet
        </button>
      </div>

      <p className="no-print text-[13px] text-gray-500 text-center my-6">
        Un email de confirmation avec votre billet a été envoyé.
      </p>

      <div className="no-print text-center">
        <Link
          href="/evenementiel"
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
          style={{ color: 'var(--color-primary)' }}
        >
          ← Retour aux événements
        </Link>
      </div>
    </div>
  );
}
