'use client';

import { useState } from 'react';
import { IconReceiptRefund, IconCalendar } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';

interface RentalReservationWithDetails {
  id: string;
  customer_name: string;
  customer_email: string;
  pickup_date: string;
  amount_paid: number;
  status: 'confirmed' | 'cancelled' | 'refunded';
  created_at: string;
  service_offerings: { title: string; slug: string } | null;
  items: { quantity: number; unit_price: number; rental_items: { name: string } | null }[];
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmée',
  cancelled: 'Annulée',
  refunded: 'Remboursée',
};

export default function RentalReservationsClient({
  initialReservations, currency,
}: {
  initialReservations: RentalReservationWithDetails[];
  currency: string;
}) {
  const [reservations, setReservations] = useState(initialReservations);
  const [refunding, setRefunding] = useState<string | null>(null);

  async function refund(id: string) {
    if (!confirm('Rembourser cette réservation et restaurer le stock ?')) return;
    setRefunding(id);
    try {
      const res = await fetch(`/api/admin/evenementiel/reservations/${id}/refund`, { method: 'POST' });
      if (res.ok) {
        setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'refunded' } : r)));
      }
    } finally {
      setRefunding(null);
    }
  }

  if (reservations.length === 0) {
    return (
      <p className="text-sm text-gray-400 bg-white rounded-2xl border border-gray-100 p-6 text-center">
        Aucune réservation pour le moment.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {reservations.map((r) => (
        <div key={r.id} className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <p className="text-sm font-semibold text-gray-900">{r.customer_name}</p>
              <p className="text-xs text-gray-500">{r.customer_email} · {r.service_offerings?.title ?? 'Service'}</p>
              <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                <IconCalendar size={12} /> Retrait le {new Date(r.pickup_date).toLocaleDateString('fr-FR')}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-2xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                {STATUS_LABELS[r.status]}
              </span>
              {r.status === 'confirmed' && (
                <button
                  type="button"
                  onClick={() => refund(r.id)}
                  disabled={refunding === r.id}
                  className="text-gray-400 hover:text-red-500 disabled:opacity-50"
                  title="Rembourser"
                >
                  <IconReceiptRefund size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2 space-y-0.5">
            {r.items.map((item, i) => (
              <div key={i} className="flex justify-between">
                <span>{item.rental_items?.name ?? 'Article'} × {item.quantity}</span>
                <span>{formatPrice(item.unit_price * item.quantity, currency)}</span>
              </div>
            ))}
            <div className="flex justify-between font-semibold pt-1 border-t border-gray-200 mt-1">
              <span>Total</span>
              <span>{formatPrice(r.amount_paid, currency)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
