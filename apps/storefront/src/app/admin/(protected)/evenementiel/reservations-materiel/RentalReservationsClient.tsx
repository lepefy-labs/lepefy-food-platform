'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconReceiptRefund, IconCalendar, IconClock, IconTruckDelivery, IconBuildingStore } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import ConfirmPaymentButton from '../../../_components/ui/ConfirmPaymentButton';
import Button from '../../../_components/ui/Button';
import type { RentalReservationRequest, RentalFulfillmentType, RentalDeliveryFeeStatus, TenantPaymentMethod } from '@lepefy/types';

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
  fulfillment_type: RentalFulfillmentType;
  delivery_street: string | null;
  delivery_house_number: string | null;
  delivery_city: string | null;
  delivery_postal_code: string | null;
  delivery_country: string | null;
  delivery_fee_status: RentalDeliveryFeeStatus;
  delivery_fee_amount: number | null;
  delivery_fee_paid_at: string | null;
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
  initialReservations, initialPendingRequests = [], rentalItemNameById = {}, currency, externalPaymentMethods = [],
}: {
  initialReservations: RentalReservationWithDetails[];
  initialPendingRequests?: RentalReservationRequest[];
  rentalItemNameById?: Record<string, string>;
  currency: string;
  externalPaymentMethods?: TenantPaymentMethod[];
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

  function updateReservation(id: string, patch: Partial<RentalReservationWithDetails>) {
    setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
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
              <span className="text-2xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600 flex items-center gap-1">
                {r.fulfillment_type === 'delivery' ? <IconTruckDelivery size={12} /> : <IconBuildingStore size={12} />}
                {r.fulfillment_type === 'delivery' ? 'Livraison' : 'Retrait boutique'}
              </span>
              <span className="text-2xs font-semibold px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                {STATUS_LABELS[r.status]}
              </span>
              {r.status === 'confirmed' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => refund(r.id)}
                  loading={refunding === r.id}
                  title="Rembourser"
                >
                  <IconReceiptRefund size={16} />
                </Button>
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

          {r.fulfillment_type === 'delivery' && (
            <div className="mt-2 text-xs text-gray-600">
              <p>{r.delivery_street} {r.delivery_house_number}, {r.delivery_postal_code} {r.delivery_city} ({r.delivery_country})</p>
              <DeliveryFeeSection reservation={r} currency={currency} externalPaymentMethods={externalPaymentMethods} onUpdate={(patch) => updateReservation(r.id, patch)} />
            </div>
          )}

          {r.fulfillment_type === 'pickup' && r.status === 'confirmed' && (
            <ConvertToDeliveryAction reservationId={r.id} onConverted={(patch) => updateReservation(r.id, { fulfillment_type: 'delivery', ...patch })} />
          )}
        </div>
      ))}
      </div>
      )}
    </div>
  );
}

function DeliveryFeeSection({
  reservation, currency, externalPaymentMethods, onUpdate,
}: {
  reservation: RentalReservationWithDetails;
  currency: string;
  externalPaymentMethods: TenantPaymentMethod[];
  onUpdate: (patch: Partial<RentalReservationWithDetails>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(reservation.delivery_fee_amount != null ? String(reservation.delivery_fee_amount) : '');
  const [methodId, setMethodId] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);

  async function submitFee() {
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/evenementiel/reservations/${reservation.id}/delivery-fee`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_fee_amount: parsedAmount, external_payment_method_id: methodId || undefined }),
      });
      const result = await res.json();
      if (res.ok) {
        onUpdate({ delivery_fee_status: 'quoted', delivery_fee_amount: parsedAmount });
        setLink(result.link ?? null);
        setEditing(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function markPaid() {
    setIsMarkingPaid(true);
    try {
      const res = await fetch(`/api/admin/evenementiel/reservations/${reservation.id}/delivery-fee/mark-paid`, { method: 'POST' });
      if (res.ok) onUpdate({ delivery_fee_status: 'paid' });
    } finally {
      setIsMarkingPaid(false);
    }
  }

  if (reservation.delivery_fee_status === 'paid') {
    return <p className="mt-1 rounded-lg bg-green-50 px-2 py-1.5 text-green-700 font-semibold">Supplément payé — {formatPrice(reservation.delivery_fee_amount ?? 0, currency)}</p>;
  }

  if (editing) {
    return (
      <div className="mt-1.5 space-y-1.5 rounded-lg bg-amber-50 p-2">
        <div className="flex gap-2">
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" step="0.01" placeholder="Montant" className="min-h-9 w-24 rounded-lg border border-black/10 px-2 text-xs" />
          <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className="min-h-9 flex-1 rounded-lg border border-black/10 px-2 text-xs">
            <option value="">Sans lien de paiement</option>
            {externalPaymentMethods.map((m) => <option key={m.id} value={m.id}>{m.label ?? m.method}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={submitFee} loading={isSubmitting}>Valider</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Annuler</Button>
        </div>
      </div>
    );
  }

  if (reservation.delivery_fee_status === 'quoted') {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-2 py-1.5">
        <span className="font-semibold text-amber-800">Supplément : {formatPrice(reservation.delivery_fee_amount ?? 0, currency)}</span>
        {link && <button type="button" onClick={() => navigator.clipboard.writeText(link)} className="text-amber-700 underline">Copier le lien</button>}
        <button type="button" onClick={() => setEditing(true)} className="text-amber-700 underline">Modifier</button>
        <Button type="button" size="sm" onClick={markPaid} loading={isMarkingPaid}>Marquer comme payé</Button>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-lg bg-amber-50 px-2 py-1.5 text-amber-800">
      <span>Supplément à évaluer</span>
      <button type="button" onClick={() => setEditing(true)} className="font-semibold underline">Évaluer le supplément</button>
    </div>
  );
}

function ConvertToDeliveryAction({
  reservationId, onConverted,
}: {
  reservationId: string;
  onConverted: (patch: Partial<RentalReservationWithDetails>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [street, setStreet] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [country, setCountry] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    if (!street.trim() || !houseNumber.trim() || !city.trim() || !postalCode.trim() || !country.trim()) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/evenementiel/reservations/${reservationId}/convert-to-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ street, house_number: houseNumber, city, postal_code: postalCode, country }),
      });
      const result = await res.json();
      if (res.ok) {
        onConverted({
          delivery_street: street, delivery_house_number: houseNumber, delivery_city: city,
          delivery_postal_code: postalCode, delivery_country: country,
          delivery_fee_status: result.deliveryFeeStatus, delivery_fee_amount: result.suggestedFeeAmount,
        });
        setOpen(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs font-semibold text-[var(--color-primary,#1d4ed8)] underline">Convertir en livraison</button>;
  }

  return (
    <div className="mt-2 space-y-1.5 rounded-lg bg-gray-50 p-2">
      <div className="grid grid-cols-2 gap-1.5">
        <input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Rue" className="min-h-9 rounded-lg border border-black/10 px-2 text-xs" />
        <input value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} placeholder="Numéro" className="min-h-9 rounded-lg border border-black/10 px-2 text-xs" />
        <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="Code postal" className="min-h-9 rounded-lg border border-black/10 px-2 text-xs" />
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ville" className="min-h-9 rounded-lg border border-black/10 px-2 text-xs" />
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Pays (ex. IT)" className="min-h-9 rounded-lg border border-black/10 px-2 text-xs col-span-2" />
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={submit} loading={isSubmitting}>Convertir</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
      </div>
    </div>
  );
}
