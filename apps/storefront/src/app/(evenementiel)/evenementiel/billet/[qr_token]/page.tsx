import {
  IconAlertCircle,
  IconCalendarEvent,
  IconCircleCheck,
  IconClock,
  IconMapPin,
  IconTicket,
  IconUser,
} from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { formatDate, formatEventTime } from '@/lib/utils/format';
import type { EventReservationStatus } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

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

function statusBadge(reservation: ReservationRow): StatusBadge {
  if (reservation.status === 'cancelled') return { label: 'Réservation annulée', className: 'bg-red-50 text-red-700 border-red-200', ok: false };
  if (reservation.status === 'refunded') return { label: 'Réservation remboursée', className: 'bg-red-50 text-red-700 border-red-200', ok: false };
  if (reservation.quantity_remaining === 0) return { label: 'Billet entièrement utilisé', className: 'bg-gray-100 text-gray-600 border-gray-200', ok: false };
  if (reservation.quantity_remaining < reservation.quantity_total) {
    return {
      label: `Billet partiellement utilisé — ${reservation.quantity_remaining}/${reservation.quantity_total} place${reservation.quantity_total > 1 ? 's' : ''} restante${reservation.quantity_remaining > 1 ? 's' : ''}`,
      className: 'bg-amber-50 text-amber-800 border-amber-200',
      ok: true,
    };
  }
  return { label: 'Billet valide', className: 'bg-green-50 text-green-700 border-green-200', ok: true };
}

export default async function BilletPage({ params }: { params: { qr_token: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const qrToken = params.qr_token;
  const supabase = createServiceClient();

  const { data: reservation } = await supabase
    .from('event_reservations')
    .select('id, tenant_id, event_id, customer_name, quantity_total, quantity_remaining, status')
    .eq('qr_token', qrToken)
    .maybeSingle();

  if (!reservation || (reservation as ReservationRow).tenant_id !== tenant.id) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-red-50 text-red-600"><IconAlertCircle size={30} /></div>
        <h1 className="mt-5 font-display text-3xl font-semibold text-gray-900">Billet introuvable</h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">Ce lien ne correspond à aucune réservation. Vérifiez l’URL de votre billet.</p>
      </main>
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
    <main className="mx-auto max-w-xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] text-[var(--color-primary)]"><IconTicket size={27} stroke={1.7} /></div>
        <p className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-primary)]">Billet numérique</p>
        <h1 className="mt-1 font-display text-3xl font-semibold text-gray-900">Votre billet</h1>
        <p className="mt-2 text-sm text-gray-500">Présentez le QR code à l’entrée de l’événement.</p>
      </div>

      <section className="mt-7 overflow-hidden rounded-[28px] border border-black/[0.06] bg-white shadow-[0_18px_45px_rgba(50,37,20,.1)]">
        {event && (
          <div className="bg-[#f7f3eb] px-5 py-6 text-center sm:px-7">
            <h2 className="font-display text-2xl font-semibold text-gray-900">{event.title}</h2>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs font-medium text-gray-600">
              <span className="flex items-center gap-1.5"><IconCalendarEvent size={14} />{formatDate(event.date_start)}</span>
              <span className="flex items-center gap-1.5"><IconClock size={14} />{formatEventTime(event.date_start)}</span>
              {event.location && <span className="flex items-center gap-1.5"><IconMapPin size={14} /><span className="max-w-[260px] truncate">{event.location}</span></span>}
            </div>
          </div>
        )}

        <div className="px-5 py-7 text-center sm:px-7">
          <div className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${badge.className}`}>
            {badge.ok ? <IconCircleCheck size={14} stroke={2} /> : <IconAlertCircle size={14} stroke={2} />}
            {badge.label}
          </div>

          {badge.ok && (
            <div className="mx-auto mt-5 w-fit rounded-3xl border border-black/[0.06] bg-white p-3 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/events/reservation-qr?token=${encodeURIComponent(qrToken)}`} alt="QR code d'entrée" className="size-60 max-w-full object-contain" />
            </div>
          )}

          <div className="mt-5 flex items-center justify-center gap-2 text-sm font-semibold text-gray-900"><IconUser size={16} className="text-gray-400" />{row.customer_name}</div>
          <p className="mt-1 text-xs text-gray-500">{row.quantity_total} place{row.quantity_total > 1 ? 's' : ''} réservée{row.quantity_total > 1 ? 's' : ''}</p>
          <p className="mt-4 font-mono text-[11px] tracking-wide text-gray-400">RÉF. #{row.id.slice(0, 8).toUpperCase()}</p>
        </div>
      </section>

      <div className="mt-5 rounded-2xl bg-[#f7f3eb] p-4 text-center text-xs leading-relaxed text-gray-500">
        Gardez ce billet accessible sur votre téléphone. La validation des entrées se fait uniquement sur place par l’équipe de {tenant.name}.
      </div>
    </main>
  );
}
