'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconReceiptRefund, IconCalendar, IconClock } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import ConfirmPaymentButton from '../../../_components/ui/ConfirmPaymentButton';
import type { RentalReservationRequest } from '@lepefy/types';

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

function elapsedLabel(createdAt: string): string {
  const minutes = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  if (minutes < 1)  return 'à l\'instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)   return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

export default function RentalReservationsClient({
  initialReservations, initialPendingRequests = [], rentalItemNameById = {}, currency,
}: {
  initialReservations: RentalReservationWithDetails[];
  initialPendingRequests?: RentalReservationRequest[];
  rentalItemNameById?: Record<string, string>;
  currency: string;
}) {
  const router = useRouter();
  const [reservations, setReservations] = useState(initialReservations);
  const [pendingRequests, setPendingRequests] = useState(initialPendingRequests);
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

  return (
    <div className="space-y-6">
      {/* Paiements en attente (Phase 3 — lien externe) — même structure
          visuelle que les bandeaux boutique/billetterie (Phase 1/2). */}
      {pendingRequests.length > 0 && (
        <section className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-2xl p-4">
          <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5 mb-1">
            <IconClock size={16} /> Paiements en attente ({pendingRequests.length})
          </h2>
          <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
            Ces demandes ne sont pas encore des réservations — aucun stock n&apos;est réservé.
          </p>
          <div className="space-y-2">
            {pendingRequests.map((request) => {
              const itemsSummary = request.items
                .map((i) => `${i.quantity}× ${rentalItemNameById[i.rental_item_id] ?? '—'}`)
                .join(', ');
              return (
                <div
                  key={request.id}
                  className="bg-white dark:bg-gray-900 rounded-xl border border-amber-100 dark:border-amber-900/60 p-3 flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {request.payment_method_label}
                      </span>
                      <span className="text-xs text-gray-400">·</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {request.customer_name || request.customer_email}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{itemsSummary}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{elapsedLabel(request.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                      {formatPrice(request.amount, currency)}
                    </span>
                    <ConfirmPaymentButton
                      endpoint={`/api/admin/evenementiel/rental-reservation-requests/${request.id}/confirm-payment`}
                      label="Confirmer réception"
                      confirmingLabel="Confirmation…"
                      className="py-2 px-3 rounded-lg font-semibold text-white text-xs whitespace-nowrap transition-opacity disabled:opacity-50"
                      style={{ backgroundColor: '#D97706' }}
                      onSuccess={(warning) => {
                        if (!warning) {
                          setPendingRequests((prev) => prev.filter((r) => r.id !== request.id));
                        }
                        router.refresh();
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {reservations.length === 0 ? (
        <p className="text-sm text-gray-400 bg-white rounded-2xl border border-gray-100 p-6 text-center">
          Aucune réservation pour le moment.
        </p>
      ) : (
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
      )}
    </div>
  );
}
