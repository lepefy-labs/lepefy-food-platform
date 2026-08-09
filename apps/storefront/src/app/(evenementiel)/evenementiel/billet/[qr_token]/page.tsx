import {
  IconCalendarEvent,
  IconMapPin,
  IconTicket,
  IconCircleCheck,
  IconAlertCircle,
  IconUser,
} from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { formatDate } from '@/lib/utils/format';
import type { EventReservationStatus } from '@lepefy/types';

// Page publique du billet — cible de l'URL encodée dans le QR
// (cf. lib/events/ticketUrl.ts). Aucune authentification : le qr_token
// (HMAC opaque, non devinable) sert de capability de lecture, même principe
// que le lien /orders/[id]?token= (token de suivi commande). LECTURE SEULE :
// aucune redemption ici — celle-ci reste exclusivement dans le scanner admin
// authentifié (/admin/evenementiel/scan → RPC redeem_event_reservation).
export const dynamic = 'force-dynamic';

interface ReservationRow {
  id: string;
  tenant_id: string;
  event_id: string;
  customer_name: string;
  quantity_total: number;
  quantity_remaining: number;
  status: EventReservationStatus;
}

interface StatusBadge {
  label: string;
  className: string;
  ok: boolean;
}

function statusBadge(r: ReservationRow): StatusBadge {
  if (r.status === 'cancelled') {
    return { label: 'Réservation annulée', className: 'bg-red-50 text-red-700 border-red-200', ok: false };
  }
  if (r.status === 'refunded') {
    return { label: 'Réservation remboursée', className: 'bg-red-50 text-red-700 border-red-200', ok: false };
  }
  if (r.quantity_remaining === 0) {
    return { label: 'Billet entièrement utilisé', className: 'bg-gray-100 text-gray-600 border-gray-200', ok: false };
  }
  if (r.quantity_remaining < r.quantity_total) {
    return {
      label: `Billet partiellement utilisé — ${r.quantity_remaining}/${r.quantity_total} place${r.quantity_total > 1 ? 's' : ''} restante${r.quantity_remaining > 1 ? 's' : ''}`,
      className: 'bg-amber-50 text-amber-800 border-amber-200',
      ok: true,
    };
  }
  return { label: 'Billet valide', className: 'bg-green-50 text-green-700 border-green-200', ok: true };
}

export default async function BilletPage({ params }: { params: { qr_token: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const qrToken  = params.qr_token;
  const supabase = createServiceClient();

  const { data: reservation } = await supabase
    .from('event_reservations')
    .select('id, tenant_id, event_id, customer_name, quantity_total, quantity_remaining, status')
    .eq('qr_token', qrToken)
    .maybeSingle();

  if (!reservation || (reservation as ReservationRow).tenant_id !== tenant.id) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
          <IconAlertCircle size={28} className="text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Billet introuvable</h1>
        <p className="text-sm text-gray-500">
          Ce lien ne correspond à aucune réservation. Vérifiez l&apos;URL de votre billet.
        </p>
      </div>
    );
  }

  const row = reservation as ReservationRow;

  const { data: event } = await supabase
    .from('events')
    .select('title, date_start, location')
    .eq('id', row.event_id)
    .maybeSingle();

  const badge = statusBadge(row);

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <div className="text-center mb-6">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-primary) 12%, white)' }}
        >
          <IconTicket size={28} stroke={1.6} color="var(--color-primary)" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Votre billet</h1>
        <p className="text-sm text-gray-500">Présentez ce billet à l&apos;entrée de l&apos;événement.</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 text-center mb-4">
        {event && (
          <>
            <p className="font-bold text-gray-900 mb-1">{event.title}</p>
            <p className="text-xs text-gray-500 flex items-center justify-center gap-1.5 mb-1">
              <IconCalendarEvent size={13} /> {formatDate(event.date_start)}
            </p>
            {event.location && (
              <p className="text-xs text-gray-500 flex items-center justify-center gap-1.5">
                <IconMapPin size={13} /> {event.location}
              </p>
            )}
          </>
        )}

        <div
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold mt-4 ${badge.className}`}
        >
          {badge.ok
            ? <IconCircleCheck size={14} stroke={2} />
            : <IconAlertCircle size={14} stroke={2} />}
          {badge.label}
        </div>

        {badge.ok && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/events/reservation-qr?token=${encodeURIComponent(qrToken)}`}
              alt="QR code d'entrée"
              className="mx-auto w-56 h-56 mt-4"
            />
          </>
        )}

        <p className="text-sm font-semibold text-gray-900 mt-4 flex items-center justify-center gap-1.5">
          <IconUser size={15} stroke={1.8} className="text-gray-400" /> {row.customer_name}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {row.quantity_total} place{row.quantity_total > 1 ? 's' : ''} réservée{row.quantity_total > 1 ? 's' : ''}
        </p>
      </div>

      <p className="text-xs text-gray-400 text-center">
        La validation des entrées se fait uniquement sur place par l&apos;équipe de {tenant.name}.
      </p>
    </div>
  );
}
