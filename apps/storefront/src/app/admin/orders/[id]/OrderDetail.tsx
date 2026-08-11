'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/utils/format';
import ConfirmPaymentButton from '../../_components/ui/ConfirmPaymentButton';
import type { Order, OrderStatus } from '@lepefy/types';

// ─── Translations ─────────────────────────────────────────────────────────────

const translations = {
  fr: {
    updateOrder:          'Mettre à jour la commande',
    status:               'Statut',
    carrier:              'Transporteur effectif',
    tracking:             'Code de suivi',
    trackingHint:         'Numéro de tracking du colis',
    notes:                'Notes internes',
    notesHint:            'Visible uniquement par vous, pas par le client',
    save:                 'Enregistrer',
    saving:               'Enregistrement…',
    saveOk:               '✓ Modifications enregistrées',
    saveError:            'Erreur lors de l\'enregistrement',
    print:                'Imprimer le récapitulatif',
    pickingList:          '📦 Liste de prélèvement',
    markAsPaid:           'Marquer comme payé',
    markingAsPaid:        'Mise à jour…',
    markAsPaidOk:         '✓ Commande marquée comme payée',
    markAsPaidError:      'Erreur lors de la mise à jour',
    pendingPaymentBanner: 'Paiement en attente — à encaisser en boutique',
    // Status labels — delivery
    preparing:            'En préparation',
    shipped:              'Expédié',
    delivered:            'Livré',
    cancelled:            'Annulé',
    // Status labels — pickup
    ready_for_pickup:     'Prêt à retirer',
    picked_up:            'Retiré',
    // Modal
    changeCarrier:        'Changer de transporteur ?',
    cancel:               'Annuler',
    confirm:              'Confirmer',
    // Shipping details section
    shippingDetails:      'Détails expédition',
    sdCarrier:            'Transporteur',
    sdService:            'Service',
    sdParcels:            'Nb colis',
    sdWeight:             'Poids total',
    sdCarrierCost:        'Coût transporteur',
    sdPackaging:          'Surplus emballage',
    sdDiscount:           'Remise livraison',
    sdFreeBadge:          'Livraison offerte',
    sdTotal:              'Total livraison facturé',
  },
  it: {
    updateOrder:          'Aggiorna ordine',
    status:               'Stato',
    carrier:              'Corriere effettivo',
    tracking:             'Codice tracking',
    trackingHint:         'Numero di tracking del pacco',
    notes:                'Note interne',
    notesHint:            'Visibile solo a te, non al cliente',
    save:                 'Salva',
    saving:               'Salvataggio…',
    saveOk:               '✓ Modifiche salvate',
    saveError:            'Errore durante il salvataggio',
    print:                'Stampa riepilogo',
    pickingList:          '📦 Lista prelievo',
    markAsPaid:           'Segna come pagato',
    markingAsPaid:        'Aggiornamento…',
    markAsPaidOk:         '✓ Ordine segnato come pagato',
    markAsPaidError:      'Errore durante l\'aggiornamento',
    pendingPaymentBanner: 'Pagamento in attesa — da incassare in negozio',
    // Status labels — delivery
    preparing:            'In preparazione',
    shipped:              'Spedito',
    delivered:            'Consegnato',
    cancelled:            'Annullato',
    // Status labels — pickup
    ready_for_pickup:     'Pronto per il ritiro',
    picked_up:            'Ritirato',
    // Modal
    changeCarrier:        'Cambiare corriere?',
    cancel:               'Annulla',
    confirm:              'Conferma',
    // Shipping details section
    shippingDetails:      'Dettagli spedizione',
    sdCarrier:            'Corriere',
    sdService:            'Servizio',
    sdParcels:            'N° colli',
    sdWeight:             'Peso totale',
    sdCarrierCost:        'Costo corriere',
    sdPackaging:          'Surplus imballaggio',
    sdDiscount:           'Sconto spedizione',
    sdFreeBadge:          'Spedizione omaggio',
    sdTotal:              'Totale spedizione fatturato',
  },
} as const;

type Lang = keyof typeof translations;

// ─── Status option lists ──────────────────────────────────────────────────────

const STATUS_OPTIONS_DELIVERY = [
  { value: 'preparing', labelKey: 'preparing' },
  { value: 'shipped',   labelKey: 'shipped'   },
  { value: 'delivered', labelKey: 'delivered' },
  { value: 'cancelled', labelKey: 'cancelled' },
] as const;

const STATUS_OPTIONS_PICKUP = [
  { value: 'preparing',        labelKey: 'preparing'        },
  { value: 'ready_for_pickup', labelKey: 'ready_for_pickup' },
  { value: 'delivered',        labelKey: 'picked_up'        },
  { value: 'cancelled',        labelKey: 'cancelled'        },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShippingDetails {
  totalWeightG?:            number;
  numParcels?:              number;
  packlinkCost?:            number;
  serviceId?:               number;
  serviceName?:             string;
  carrierName?:             string;
  vatSource?:               'packlink' | 'db';
  vatRate?:                 number;
  vatAmount?:               number;
  surchargeMode?:           string;
  packagingSurchargeTotal?: number;
  boxDimensions?:           { length: number; width: number; height: number };
  // Règles commerciales par pays (shipping_country_rules) — voir
  // lib/shipping/resolveCountryRule.ts. Absents tant qu'aucune règle ne
  // s'applique à la commande.
  countryRuleApplied?:      boolean;
  originalShippingCost?:    number;
  discountApplied?:         number;
  freeShippingApplied?:     boolean;
}

interface Props {
  order:            Order;
  currency:         string;
  carriers:         { name: string }[];
  shippingDetails:  ShippingDetails | null;
  shippingProvider: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CARRIER_MAP: Record<string, string> = {
  brt:         'BRT',
  bartolini:   'BRT',
  dhl:         'DHL',
  fedex:       'FedEx',
  tnt:         'TNT',
  gls:         'GLS',
  ups:         'UPS',
  sda:         'SDA',
  poste:       'Poste Italiane',
  'poste italiane': 'Poste Italiane',
  dpd:         'DPD',
  nexive:      'Nexive',
};

function formatCarrierName(raw: string | undefined): string {
  if (!raw) return '—';
  const key = raw.toLowerCase().trim();
  return CARRIER_MAP[key] ?? raw.trim();
}

function vatLabel(sd: ShippingDetails, lang: Lang): string {
  const pct = Math.round((sd.vatRate ?? 0) * 100);
  if ((sd.vatSource ?? '') === 'packlink') {
    return lang === 'fr' ? 'TVA (incluse Packlink)' : 'IVA (inclusa Packlink)';
  }
  return lang === 'fr'
    ? `TVA livraison (${pct}% — appliquée par le système)`
    : `IVA spedizione (${pct}% — applicata dal sistema)`;
}

// ─── Field row ────────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  bold,
  accent,
}: {
  label:   string;
  value:   string;
  bold?:   boolean;
  accent?: boolean;
}) {
  return (
    <div className={`flex justify-between items-baseline gap-2 text-sm ${bold ? 'font-semibold' : ''}`}>
      <span className="text-gray-400 text-xs shrink-0">{label}</span>
      <span className={`text-right ${accent ? 'text-[var(--color-primary)] font-semibold' : bold ? 'text-gray-900' : 'text-gray-700'}`}>
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-gray-100 my-2" />;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrderDetail({
  order,
  currency,
  carriers,
  shippingDetails,
  shippingProvider,
}: Props) {
  const router = useRouter();

  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('lepefy-admin-lang') as Lang) ?? 'fr';
    }
    return 'fr';
  });

  const isPickup = order.fulfillment_type === 'pickup';
  const isInStorePending =
    order.payment_method === 'in_store' && order.payment_status === 'pending';

  // Carrier — priority: tracking_carrier > Packlink suggestion > first in list
  const packlinkCarrier = shippingDetails?.carrierName ?? '';
  const originalCarrier =
    order.tracking_carrier ?? packlinkCarrier ?? carriers[0]?.name ?? '';

  const [status,         setStatus]         = useState<OrderStatus>(order.status);
  const [carrier,        setCarrier]        = useState(originalCarrier);
  const [pendingCarrier, setPendingCarrier] = useState<string | null>(null);
  const [showConfirm,    setShowConfirm]    = useState(false);
  const [trackingCode,   setTrackingCode]   = useState(order.tracking_code ?? '');
  const [notes,          setNotes]          = useState(order.notes ?? '');
  const [saving,         setSaving]         = useState(false);
  const [saveMsg,        setSaveMsg]        = useState<string | null>(null);
  const [saveError,      setSaveError]      = useState(false);
  const [isPaid,         setIsPaid]         = useState(!isInStorePending);

  const t = translations[lang];

  // Dynamic label for the suggested carrier in the modal
  const suggestedCarrierLabel: string = (() => {
    const labels = {
      packlink:    lang === 'fr' ? 'Transporteur suggéré :' : 'Corriere suggerito :',
      flat_rate:   lang === 'fr' ? 'Transporteur par défaut :' : 'Corriere predefinito :',
      pickup_only: lang === 'fr' ? 'Transporteur :' : 'Corriere :',
    };
    return labels[shippingProvider as keyof typeof labels]
      ?? (lang === 'fr' ? 'Transporteur suggéré :' : 'Corriere suggerito :');
  })();

  const statusOptions = isPickup ? STATUS_OPTIONS_PICKUP : STATUS_OPTIONS_DELIVERY;

  // STATUS_OPTIONS_PICKUP ne propose jamais 'shipped' (picked_up y tient sa place) :
  // cette situation ne peut donc se produire que pour une livraison, sans condition
  // supplémentaire sur fulfillment_type nécessaire.
  const shippedWithoutTracking =
    status === 'shipped' && (!trackingCode || trackingCode.trim() === '');

  function switchLang(l: Lang) {
    setLang(l);
    localStorage.setItem('lepefy-admin-lang', l);
  }

  function handleCarrierChange(newValue: string) {
    if (newValue !== originalCarrier && packlinkCarrier && newValue !== packlinkCarrier) {
      setPendingCarrier(newValue);
      setShowConfirm(true);
    } else {
      setCarrier(newValue);
    }
  }

  function confirmCarrierChange() {
    if (pendingCarrier) setCarrier(pendingCarrier);
    setPendingCarrier(null);
    setShowConfirm(false);
  }

  function cancelCarrierChange() {
    setPendingCarrier(null);
    setShowConfirm(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    setSaveError(false);
    try {
      const body: Record<string, unknown> = {
        status,
        notes: notes.trim() || null,
      };
      if (!isPickup) {
        body.tracking_carrier = carrier.trim() || null;
        body.tracking_code    = trackingCode.trim() || null;
      }
      const res = await fetch(`/api/admin/orders/${order.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      setSaveMsg(t.saveOk);
      router.refresh();
    } catch {
      setSaveMsg(t.saveError);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

  // Fully-typed shipping details (safe — all fields accessed via optional chaining below)
  const sd = shippingDetails;

  return (
    <>
      {/* Lang toggle */}
      <div className="flex justify-end gap-1 -mb-2">
        {(['fr', 'it'] as Lang[]).map((l) => (
          <button
            key={l}
            onClick={() => switchLang(l)}
            className={`text-xs px-2 py-1 rounded font-medium border transition-colors ${
              lang === l
                ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary-light)]'
                : 'border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {/* In-store payment banner + mark-as-paid */}
      {order.payment_method === 'in_store' && !isPaid && (
        <section className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-800 mb-3">
            🏪 {t.pendingPaymentBanner}
          </p>
          <ConfirmPaymentButton
            mode="in_store"
            id={order.id}
            label={t.markAsPaid}
            confirmingLabel={t.markingAsPaid}
            onSuccess={() => {
              setIsPaid(true);
              router.refresh();
            }}
          />
        </section>
      )}

      {/* Section 3 — Shipping details (delivery + Packlink only) */}
      {!isPickup && sd && (
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            {t.shippingDetails}
            {sd.freeShippingApplied && (
              <span
                className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-semibold align-middle"
                style={{ background: '#F0FDF4', color: '#15803D', border: '0.5px solid #BBF7D0' }}
              >
                {t.sdFreeBadge}
              </span>
            )}
          </h2>
          <div className="space-y-2">
            {sd.carrierName && (
              <Field
                label={t.sdCarrier}
                value={formatCarrierName(sd.carrierName)}
              />
            )}
            {sd.serviceName && (
              <Field label={t.sdService} value={sd.serviceName} />
            )}
            {sd.numParcels != null && (
              <Field label={t.sdParcels} value={String(sd.numParcels)} />
            )}
            {sd.totalWeightG != null && (
              <Field
                label={t.sdWeight}
                value={(sd.totalWeightG / 1000).toFixed(2) + ' kg'}
              />
            )}
            <Divider />
            {sd.packlinkCost != null && (
              <Field
                label={t.sdCarrierCost}
                value={formatPrice(sd.packlinkCost, currency)}
              />
            )}
            {sd.vatAmount != null && (
              <Field
                label={vatLabel(sd, lang)}
                value={formatPrice(sd.vatAmount, currency)}
              />
            )}
            {sd.packagingSurchargeTotal != null && sd.packagingSurchargeTotal > 0 && (
              <Field
                label={t.sdPackaging}
                value={formatPrice(sd.packagingSurchargeTotal, currency)}
              />
            )}
            {sd.discountApplied != null && sd.discountApplied > 0 && (
              <Field
                label={t.sdDiscount}
                value={'-' + formatPrice(sd.discountApplied, currency)}
              />
            )}
            <Divider />
            <Field
              label={t.sdTotal}
              value={formatPrice(order.shipping_cost, currency)}
              bold
            />
          </div>
        </section>
      )}

      {/* Section 4 — Update form */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">{t.updateOrder}</h2>

        <div className="space-y-4">
          {/* Status */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">{t.status}</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as OrderStatus)}
              className={inputClass}
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t[opt.labelKey as keyof typeof t] as string}
                </option>
              ))}
            </select>
          </div>

          {/* Carrier + tracking — delivery only */}
          {!isPickup && (
            <>
              {/* Carrier select with confirmation modal */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 font-medium">{t.carrier}</label>

                {showConfirm && (
                  <div style={{
                    border: '1px solid #E5E7EB', borderRadius: 10, background: '#fff',
                    padding: 16, marginBottom: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  }}>
                    <p className="text-sm font-semibold text-gray-800 mb-3">{t.changeCarrier}</p>
                    <div className="space-y-1.5 text-sm mb-4">
                      {packlinkCarrier && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-xs w-40 shrink-0">{suggestedCarrierLabel}</span>
                          <span className="font-medium text-gray-700">{packlinkCarrier}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400 text-xs w-40 shrink-0">
                          {lang === 'fr' ? 'Nouveau transporteur :' : 'Nuovo corriere :'}
                        </span>
                        <span className="font-semibold text-gray-900">{pendingCarrier}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={cancelCarrierChange}
                        className="px-4 py-1.5 rounded-lg text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        {t.cancel}
                      </button>
                      <button
                        onClick={confirmCarrierChange}
                        className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-colors"
                        style={{ backgroundColor: 'var(--color-primary)' }}
                      >
                        {t.confirm}
                      </button>
                    </div>
                  </div>
                )}

                <select
                  value={carrier}
                  onChange={(e) => handleCarrierChange(e.target.value)}
                  className={inputClass}
                >
                  {carrier && !carriers.some((c) => c.name === carrier) && (
                    <option value={carrier}>{carrier}</option>
                  )}
                  {carriers.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Tracking code */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5 font-medium">{t.tracking}</label>
                <input
                  type="text"
                  value={trackingCode}
                  onChange={(e) => setTrackingCode(e.target.value)}
                  placeholder={t.trackingHint}
                  className={inputClass}
                />
              </div>
            </>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">{t.notes}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t.notesHint}
              rows={3}
              className={inputClass + ' resize-none'}
            />
          </div>

          {saveMsg && (
            <p className={`text-sm ${saveError ? 'text-red-600' : 'text-green-600'}`}>
              {saveMsg}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={saving || shippedWithoutTracking}
            className="w-full py-2.5 rounded-lg font-semibold text-white text-sm disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {saving ? t.saving : t.save}
          </button>

          {shippedWithoutTracking && (
            <p className="text-xs text-red-600 mt-2">
              {lang === 'fr'
                ? 'Le code de suivi est requis pour marquer la commande comme expédiée.'
                : 'Il codice di tracking è obbligatorio per segnare l\'ordine come spedito.'}
            </p>
          )}
        </div>
      </section>

      {/* Section 5 — Print controls */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-col gap-3">
          {/* Picking list — primary print action */}
          <div>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-white text-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {t.pickingList}
            </button>
            <p className="text-xs text-gray-400 mt-1.5">
              {lang === 'fr'
                ? 'Feuille de prélèvement magazzin — triée par emplacement'
                : 'Foglio prelievo magazzino — ordinato per ubicazione'}
            </p>
          </div>

          {/* Summary print — secondary */}
          <div className="border-t border-gray-100 pt-3">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors"
            >
              <span>🖨</span> {t.print}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
