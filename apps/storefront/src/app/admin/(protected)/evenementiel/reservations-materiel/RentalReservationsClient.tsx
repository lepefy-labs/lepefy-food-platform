'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useConfirm } from '@/app/admin/_components/ui/ConfirmDialog';
import { useRouter } from 'next/navigation';
import { IconReceiptRefund, IconCalendar, IconClock, IconTruckDelivery, IconBuildingStore, IconPencil, IconCopy, IconCheck, IconBrandWhatsapp } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { formatDate, formatMoney } from '@/lib/admin/format';
import { RENTAL_DELIVERY_FEE_STATUS_META, statusMeta } from '@/lib/admin/statusRegistry';
import { buildExternalPaymentLink, isLinkPaymentMethod, linkIncludesAmount } from '@/lib/payments/externalPaymentLink';
import { deliveryFeeMessage, normalizeDeliveryFeeAmount } from '@/lib/rental/deliveryFee';
import { buildWhatsAppShareUrl } from '@/lib/orders/assisted/assistedOrderPolicy';
import { countryLabel, isDeliveryCountry, isValidPostalCode, normalizeAddressParts, normalizePostalCode } from '@/lib/address/addressRules';
import type { PostalLookupCity } from '@/lib/address/postalLookup';
import ConfirmPaymentButton from '../../../_components/ui/ConfirmPaymentButton';
import Button, { buttonClasses } from '../../../_components/ui/Button';
import Badge from '../../../_components/ui/Badge';
import ShareLinkActions from '../../../_components/ui/ShareLinkActions';
import InlineAlert from '../../../_components/ui/InlineAlert';
import { FormField, Input, Select } from '../../../_components/ui/Form';
import { useAdminToast } from '../../../_components/ui/Toaster';
import type { RentalReservationRequest, RentalFulfillmentType, RentalDeliveryFeeStatus, TenantPaymentMethod } from '@lepefy/types';

interface RentalReservationWithDetails {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
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
  delivery_fee_quoted_at: string | null;
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
  initialReservations, initialPendingRequests = [], rentalItemNameById = {}, currency, externalPaymentMethods = [], deliveryCountries,
}: {
  initialReservations: RentalReservationWithDetails[];
  /** Pays proposés pour une conversion en livraison (jamais vide). */
  deliveryCountries: string[];
  initialPendingRequests?: RentalReservationRequest[];
  rentalItemNameById?: Record<string, string>;
  currency: string;
  externalPaymentMethods?: TenantPaymentMethod[];
}) {
  const router = useRouter();
  const [reservations, setReservations] = useState(initialReservations);
  const [pendingRequests, setPendingRequests] = useState(initialPendingRequests);
  const [refunding, setRefunding] = useState<string | null>(null);
  const [ask, confirmDialog] = useConfirm();

  async function refund(id: string) {
    if (!(await ask({ title: 'Rembourser cette réservation ?', description: 'Le client est remboursé et le stock du matériel est restauré.', confirmLabel: 'Rembourser', destructive: true }))) return;
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
      {confirmDialog}
      {/* Paiements en attente (Phase 3 — lien externe) — même structure
          visuelle que les bandeaux boutique/billetterie (Phase 1/2). */}
      {pendingRequests.length > 0 && (
        <section className="bg-tone-warning-bg border border-tone-warning-border rounded-2xl p-4">
          <h2 className="text-sm font-bold text-tone-warning-fg flex items-center gap-1.5 mb-1">
            <IconClock size={16} /> Paiements en attente ({pendingRequests.length})
          </h2>
          <p className="text-xs text-tone-warning-fg mb-3">
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
                  className="bg-a-surface rounded-xl border border-tone-warning-border p-3 flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-a-text">
                        {request.payment_method_label}
                      </span>
                      <span className="text-xs text-a-text-3">·</span>
                      <span className="text-xs text-a-text-3">
                        {request.customer_name || request.customer_email}
                      </span>
                    </div>
                    <p className="text-xs text-a-text-3 truncate mt-0.5">{itemsSummary}</p>
                    <p className="text-xs text-a-text-3 mt-0.5">{elapsedLabel(request.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm font-bold text-a-text">
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
        <p className="text-sm text-a-text-3 bg-a-surface rounded-2xl border border-a-border p-6 text-center">
          Aucune réservation pour le moment.
        </p>
      ) : (
      <div className="space-y-3">
      {reservations.map((r) => (
        <div key={r.id} className="bg-a-surface rounded-2xl border border-a-border p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <p className="text-sm font-semibold text-a-text">{r.customer_name}</p>
              <p className="text-xs text-a-text-3">{r.customer_email} · {r.service_offerings?.title ?? 'Service'}</p>
              <p className="text-xs text-a-text-3 flex items-center gap-1 mt-0.5">
                <IconCalendar size={12} /> Retrait le {new Date(r.pickup_date).toLocaleDateString('fr-FR')}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-a-hover text-a-text-2 flex items-center gap-1">
                {r.fulfillment_type === 'delivery' ? <IconTruckDelivery size={12} /> : <IconBuildingStore size={12} />}
                {r.fulfillment_type === 'delivery' ? 'Livraison' : 'Retrait boutique'}
              </span>
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-a-hover text-a-text-2">
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
          <div className="text-xs text-a-text-2 bg-a-surface-2 rounded-lg p-2 space-y-0.5">
            {r.items.map((item, i) => (
              <div key={i} className="flex justify-between">
                <span>{item.rental_items?.name ?? 'Article'} × {item.quantity}</span>
                <span>{formatPrice(item.unit_price * item.quantity, currency)}</span>
              </div>
            ))}
            <div className="flex justify-between font-semibold pt-1 border-t border-a-border mt-1">
              <span>Total</span>
              <span>{formatPrice(r.amount_paid, currency)}</span>
            </div>
          </div>

          {r.fulfillment_type === 'delivery' && (
            <div className="mt-2 text-xs text-a-text-2">
              <p>{r.delivery_street} {r.delivery_house_number}, {r.delivery_postal_code} {r.delivery_city}{r.delivery_country ? ` (${countryLabel(r.delivery_country)})` : ''}</p>
              <DeliveryFeeSection reservation={r} currency={currency} externalPaymentMethods={externalPaymentMethods} onUpdate={(patch) => updateReservation(r.id, patch)} />
            </div>
          )}

          {r.fulfillment_type === 'pickup' && r.status === 'confirmed' && (
            <ConvertToDeliveryAction reservationId={r.id} countries={deliveryCountries} currency={currency} onConverted={(patch) => updateReservation(r.id, { fulfillment_type: 'delivery', ...patch })} />
          )}
        </div>
      ))}
      </div>
      )}
    </div>
  );
}

// Supplément de livraison après la réservation : à évaluer → proposé (lien et
// message envoyés à la main par l'équipe) → payé. Un supplément payé n'est
// plus modifiable (contrôlé aussi par l'API).
function DeliveryFeeSection({
  reservation, currency, externalPaymentMethods, onUpdate,
}: {
  reservation: RentalReservationWithDetails;
  currency: string;
  externalPaymentMethods: TenantPaymentMethod[];
  onUpdate: (patch: Partial<RentalReservationWithDetails>) => void;
}) {
  const toast = useAdminToast();
  const [ask, confirmDialog] = useConfirm();
  const status = reservation.delivery_fee_status;
  const meta = statusMeta(RENTAL_DELIVERY_FEE_STATUS_META, status);
  const fee = reservation.delivery_fee_amount ?? 0;
  const editable = reservation.status === 'confirmed' && (status === 'pending_quote' || status === 'quoted');
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(reservation.delivery_fee_amount != null ? String(reservation.delivery_fee_amount) : '');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const linkMethods = externalPaymentMethods.filter(isLinkPaymentMethod);
  const [methodId, setMethodId] = useState(linkMethods[0]?.id ?? '');
  const method = linkMethods.find((entry) => entry.id === methodId) ?? null;
  const link = method ? buildExternalPaymentLink(method, fee, currency) : null;
  const message = deliveryFeeMessage({
    customerName: reservation.customer_name,
    dateLabel: formatDate(reservation.pickup_date),
    amountLabel: formatMoney(fee, currency),
    link,
  });
  const [messageCopied, setMessageCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  function startEditing() {
    setAmount(reservation.delivery_fee_amount != null ? String(reservation.delivery_fee_amount) : '');
    setAmountError(null);
    setFormError(null);
    setEditing(true);
  }

  async function submitFee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const check = normalizeDeliveryFeeAmount(amount);
    if (!check.ok) {
      setAmountError(check.error);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/admin/evenementiel/reservations/${reservation.id}/delivery-fee`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery_fee_amount: check.amount }),
      });
      const result = await res.json().catch(() => ({})) as {
        error?: string; field?: string; delivery_fee_amount?: number; delivery_fee_quoted_at?: string;
      };
      if (!res.ok) {
        if (result.field === 'delivery_fee_amount') setAmountError(result.error ?? 'Montant invalide.');
        else setFormError(result.error ?? 'Enregistrement impossible. Réessayez.');
        return;
      }
      onUpdate({
        delivery_fee_status: 'quoted',
        delivery_fee_amount: result.delivery_fee_amount ?? check.amount,
        delivery_fee_quoted_at: result.delivery_fee_quoted_at ?? new Date().toISOString(),
      });
      setEditing(false);
      toast.success('Supplément enregistré.', { description: 'Envoyez le lien ou le message au client.' });
    } catch {
      setFormError('Connexion impossible. Vérifiez le réseau puis réessayez.');
    } finally {
      setSaving(false);
    }
  }

  async function markPaid() {
    if (markingPaid) return;
    const confirmed = await ask({
      title: 'Confirmer le paiement du supplément ?',
      description: `Vous confirmez avoir reçu ${formatMoney(fee, currency)} de ${reservation.customer_name} pour la livraison. Le montant ne pourra plus être modifié.`,
      confirmLabel: 'Confirmer le paiement',
    });
    if (!confirmed) return;
    setMarkingPaid(true);
    try {
      const res = await fetch(`/api/admin/evenementiel/reservations/${reservation.id}/delivery-fee/mark-paid`, { method: 'POST' });
      const result = await res.json().catch(() => ({})) as { error?: string; delivery_fee_paid_at?: string | null };
      if (!res.ok) {
        toast.error(result.error ?? 'Confirmation impossible. Réessayez.');
        return;
      }
      onUpdate({ delivery_fee_status: 'paid', delivery_fee_paid_at: result.delivery_fee_paid_at ?? new Date().toISOString() });
      toast.success('Supplément marqué comme payé.');
    } catch {
      toast.error('Connexion impossible. Vérifiez le réseau puis réessayez.');
    } finally {
      setMarkingPaid(false);
    }
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message);
      setMessageCopied('copied');
    } catch {
      setMessageCopied('failed');
    }
    window.setTimeout(() => setMessageCopied('idle'), 2500);
  }

  // Même horodatage pour la proposition et le paiement : supplément de zone
  // payé avec la réservation au checkout.
  const paidWithReservation = status === 'paid' && Boolean(reservation.delivery_fee_paid_at)
    && reservation.delivery_fee_paid_at === reservation.delivery_fee_quoted_at;

  return (
    <section aria-label="Supplément de livraison" className="mt-2 space-y-3 rounded-xl border border-a-border bg-a-surface-2 p-3">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-a-text">Supplément de livraison</h3>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>

      {status === 'paid' && (
        <div>
          <p className="text-base font-semibold tabular-nums text-a-text">{formatMoney(fee, currency)}</p>
          <p className="text-xs text-a-text-3">
            {paidWithReservation
              ? 'Inclus dans le paiement de la réservation.'
              : reservation.delivery_fee_paid_at ? `Payé le ${formatDate(reservation.delivery_fee_paid_at)}.` : 'Payé.'}
          </p>
        </div>
      )}

      {editing && (
        <form onSubmit={submitFee} noValidate className="space-y-3">
          <FormField label={`Montant (${currency.toUpperCase()})`} required error={amountError} hint={status === 'pending_quote' ? 'Aucune zone ne correspond à cette adresse.' : undefined}>
            <Input
              value={amount}
              onChange={(event) => { setAmount(event.target.value); setAmountError(null); setFormError(null); }}
              inputMode="decimal"
              autoComplete="off"
              placeholder="Ex. 15"
              className="sm:max-w-40"
            />
          </FormField>
          {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={saving}>Enregistrer le supplément</Button>
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>Annuler</Button>
          </div>
        </form>
      )}

      {!editing && status === 'pending_quote' && (
        <div className="space-y-2">
          <p className="text-xs leading-5 text-a-text-3">Aucune zone ne correspond à cette adresse : fixez le montant, puis envoyez-le au client.</p>
          {editable
            ? <Button type="button" size="sm" onClick={startEditing}>Fixer le supplément</Button>
            : <p className="text-xs text-a-text-3">Réservation annulée ou remboursée.</p>}
        </div>
      )}

      {!editing && status === 'quoted' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-base font-semibold tabular-nums text-a-text">{formatMoney(fee, currency)}</p>
              {reservation.delivery_fee_quoted_at && <p className="text-xs text-a-text-3">Proposé le {formatDate(reservation.delivery_fee_quoted_at)}.</p>}
            </div>
            {editable && <Button type="button" size="sm" variant="ghost" onClick={startEditing}><IconPencil size={16} aria-hidden="true" /> Modifier</Button>}
          </div>
          {editable && (
            <>
              {linkMethods.length > 0 ? (
                <FormField label="Lien de paiement" hint={method && !linkIncludesAmount(method) ? 'Ce lien ne contient pas le montant : il est indiqué dans le message.' : undefined}>
                  <Select value={methodId} onChange={(event) => setMethodId(event.target.value)}>
                    {linkMethods.map((entry) => <option key={entry.id} value={entry.id}>{entry.label ?? entry.method}</option>)}
                  </Select>
                </FormField>
              ) : (
                <p className="text-xs leading-5 text-a-text-3">Aucun moyen de paiement par lien n’est activé pour la location : le message ne contient pas de lien.</p>
              )}
              {link && <ShareLinkActions url={link} message={message} phone={reservation.customer_phone} />}
              <div className="space-y-2">
                <p className="whitespace-pre-line rounded-lg border border-dashed border-a-border-strong bg-a-surface px-3 py-2 text-xs leading-5 text-a-text-2">{message}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={copyMessage}>
                    {messageCopied === 'copied' ? <IconCheck size={16} aria-hidden="true" /> : <IconCopy size={16} aria-hidden="true" />}
                    {messageCopied === 'copied' ? 'Message copié' : 'Copier le message'}
                  </Button>
                  {!link && (
                    <a href={buildWhatsAppShareUrl(reservation.customer_phone, message)} target="_blank" rel="noopener noreferrer" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                      <IconBrandWhatsapp size={16} aria-hidden="true" /> Partager sur WhatsApp
                    </a>
                  )}
                </div>
                <span role="status" className="sr-only">{messageCopied === 'copied' ? 'Message copié' : ''}</span>
                {messageCopied === 'failed' && <p className="text-xs text-tone-warning-fg">Copie impossible : sélectionnez le message et copiez-le manuellement.</p>}
              </div>
              <Button type="button" onClick={markPaid} loading={markingPaid} className="w-full sm:w-auto">Marquer comme payé</Button>
            </>
          )}
          {!editable && <p className="text-xs text-a-text-3">Réservation annulée ou remboursée.</p>}
        </div>
      )}
    </section>
  );
}

type ConvertField = 'street' | 'house_number' | 'postal_code' | 'city' | 'country';

interface ConvertResponse {
  error?: string;
  field?: ConvertField;
  deliveryFeeStatus?: RentalDeliveryFeeStatus;
  suggestedFeeAmount?: number | null;
  zoneLabel?: string | null;
  address?: { street: string; house_number: string; postal_code: string; city: string; country: string };
}

// Passage retrait → livraison : mêmes contrôles d'adresse que le checkout
// location (normalizeAddressParts), côté navigateur puis côté serveur.
function ConvertToDeliveryAction({
  reservationId, countries, currency, onConverted,
}: {
  reservationId: string;
  countries: string[];
  currency: string;
  onConverted: (patch: Partial<RentalReservationWithDetails>) => void;
}) {
  const toast = useAdminToast();
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState(countries[0] ?? 'IT');
  const [street, setStreet] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [cityFromPostal, setCityFromPostal] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<ConvertField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function clearError(field: ConvertField) {
    setErrors((previous) => {
      if (!previous[field]) return previous;
      const next = { ...previous };
      delete next[field];
      return next;
    });
    setFormError(null);
  }

  async function lookupCity(value: string) {
    const postal = normalizePostalCode(country, value);
    if (!isDeliveryCountry(country) || !isValidPostalCode(country, postal)) {
      setCityOptions([]);
      return;
    }
    try {
      const res = await fetch(`/api/address/postal-lookup?country=${country}&postalCode=${encodeURIComponent(postal)}`);
      const result = await res.json().catch(() => ({ cities: [] })) as { cities?: PostalLookupCity[] };
      const names = [...new Set((result.cities ?? []).map((entry) => entry.city))];
      const [onlyCity] = names;
      if (names.length === 1 && onlyCity && !city.trim()) {
        setCity(onlyCity);
        setCityFromPostal(true);
        clearError('city');
      }
      setCityOptions(names.length > 1 ? names : []);
    } catch {
      // Suggestion facultative : la saisie reste possible.
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const check = normalizeAddressParts({ street, houseNumber, postalCode, city, country });
    if (!check.ok) {
      setErrors({ [check.field]: check.error });
      return;
    }
    setIsSubmitting(true);
    setFormError(null);
    try {
      const { address } = check;
      const res = await fetch(`/api/admin/evenementiel/reservations/${reservationId}/convert-to-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          street: address.street, house_number: address.houseNumber, postal_code: address.postalCode, city: address.city, country: address.country,
        }),
      });
      const result = await res.json().catch(() => ({})) as ConvertResponse;
      if (!res.ok || !result.address || !result.deliveryFeeStatus) {
        if (result.field) setErrors({ [result.field]: result.error ?? 'Valeur invalide.' });
        else setFormError(result.error ?? 'Passage en livraison impossible. Réessayez.');
        return;
      }
      onConverted({
        delivery_street: result.address.street,
        delivery_house_number: result.address.house_number,
        delivery_postal_code: result.address.postal_code,
        delivery_city: result.address.city,
        delivery_country: result.address.country,
        delivery_fee_status: result.deliveryFeeStatus,
        delivery_fee_amount: result.suggestedFeeAmount ?? null,
        delivery_fee_quoted_at: result.deliveryFeeStatus === 'quoted' ? new Date().toISOString() : null,
        delivery_fee_paid_at: null,
      });
      setOpen(false);
      toast.success('Réservation passée en livraison.', {
        description: result.zoneLabel
          ? `Zone « ${result.zoneLabel} », supplément proposé ${formatMoney(result.suggestedFeeAmount ?? 0, currency)}.`
          : 'Aucune zone : supplément à évaluer.',
      });
    } catch {
      setFormError('Connexion impossible. Vérifiez le réseau puis réessayez.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" className="mt-2 -ml-2.5 text-a-brand-fg" onClick={() => setOpen(true)}>
        <IconTruckDelivery size={16} aria-hidden="true" /> Convertir en livraison
      </Button>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-3 rounded-xl border border-a-border bg-a-surface-2 p-3">
      <p className="text-sm font-semibold text-a-text">Adresse de livraison</p>
      <FormField label="Pays" error={errors.country}>
        <Select value={country} onChange={(event) => { setCountry(event.target.value); setCityOptions([]); clearError('country'); clearError('postal_code'); }}>
          {countries.map((code) => <option key={code} value={code}>{countryLabel(code)}</option>)}
        </Select>
      </FormField>
      <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3">
        <FormField label="Rue" error={errors.street}>
          <Input value={street} onChange={(event) => { setStreet(event.target.value); clearError('street'); }} autoComplete="off" placeholder="Ex. Via Roma" />
        </FormField>
        <FormField label="N°" error={errors.house_number}>
          <Input value={houseNumber} onChange={(event) => { setHouseNumber(event.target.value); clearError('house_number'); }} autoComplete="off" placeholder="Ex. 25" />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Code postal" error={errors.postal_code}>
          <Input
            value={postalCode}
            onChange={(event) => { setPostalCode(event.target.value); clearError('postal_code'); }}
            onBlur={(event) => lookupCity(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
          />
        </FormField>
        <FormField label="Ville" error={errors.city} hint={cityFromPostal && !errors.city ? 'Ville remplie à partir du code postal.' : undefined}>
          <Input value={city} onChange={(event) => { setCity(event.target.value); setCityFromPostal(false); clearError('city'); }} autoComplete="off" />
        </FormField>
      </div>
      {cityOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Villes de ce code postal">
          <span className="text-xs text-a-text-3">Villes de ce code postal :</span>
          {cityOptions.map((name) => (
            <Button key={name} type="button" variant="secondary" size="sm" onClick={() => { setCity(name); setCityOptions([]); clearError('city'); }}>{name}</Button>
          ))}
        </div>
      )}
      {formError && <InlineAlert tone="danger">{formError}</InlineAlert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={isSubmitting}>Passer en livraison</Button>
        <Button type="button" size="sm" variant="ghost" disabled={isSubmitting} onClick={() => setOpen(false)}>Annuler</Button>
      </div>
    </form>
  );
}
