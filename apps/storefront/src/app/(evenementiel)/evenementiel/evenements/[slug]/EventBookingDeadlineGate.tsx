'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { IconClock } from '@tabler/icons-react';

interface Props {
  bookingClosesAt: string | null;
  capacityRemaining: number;
  children: ReactNode;
}

function formatDeadline(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function EventBookingDeadlineGate({ bookingClosesAt, capacityRemaining, children }: Props) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!bookingClosesAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [bookingClosesAt]);

  const deadline = useMemo(() => {
    if (!bookingClosesAt) return null;
    const timestamp = new Date(bookingClosesAt).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }, [bookingClosesAt]);

  if (!bookingClosesAt || deadline === null) return <>{children}</>;

  if (now === null) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-2xl border border-black/[0.08] bg-white px-4 py-3 text-sm font-semibold text-gray-700" role="status">
          <IconClock size={18} className="mt-0.5 shrink-0" />
          <span>Réservations ouvertes jusqu’au {formatDeadline(bookingClosesAt)}</span>
        </div>
        {children}
      </div>
    );
  }

  const remainingMs = deadline - now;
  if (remainingMs <= 0) {
    return (
      <div className="rounded-3xl border border-gray-200 bg-white p-7 text-center shadow-sm">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-gray-100 text-gray-600">
          <IconClock size={21} />
        </div>
        <p className="mt-3 font-display text-2xl font-semibold text-gray-900">Réservations clôturées</p>
        <p className="mt-2 text-sm text-gray-500">Les réservations en ligne ont fermé le {formatDeadline(bookingClosesAt)}.</p>
      </div>
    );
  }

  const hoursRemaining = remainingMs / 3_600_000;
  const scarcePlaces = capacityRemaining > 0 && capacityRemaining <= 10 ? ` · plus que ${capacityRemaining} place${capacityRemaining > 1 ? 's' : ''}` : '';

  let message = `Réservations ouvertes jusqu’au ${formatDeadline(bookingClosesAt)}`;
  let tone = 'border-black/[0.08] bg-white text-gray-700';

  if (hoursRemaining <= 2) {
    message = `Clôture des réservations dans moins de 2 h · ${formatTime(bookingClosesAt)}${scarcePlaces}`;
    tone = 'border-red-200 bg-red-50 text-red-800';
  } else if (hoursRemaining <= 6) {
    message = `Dernières heures pour réserver · clôture à ${formatTime(bookingClosesAt)}${scarcePlaces}`;
    tone = 'border-orange-200 bg-orange-50 text-orange-900';
  } else if (hoursRemaining <= 24) {
    message = `Plus que ${Math.ceil(hoursRemaining)} h pour réserver · clôture à ${formatTime(bookingClosesAt)}${scarcePlaces}`;
    tone = 'border-amber-200 bg-amber-50 text-amber-900';
  }

  return (
    <div className="space-y-4">
      <div className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm font-semibold ${tone}`} role="status">
        <IconClock size={18} className="mt-0.5 shrink-0" />
        <span>{message}</span>
      </div>
      {children}
    </div>
  );
}
