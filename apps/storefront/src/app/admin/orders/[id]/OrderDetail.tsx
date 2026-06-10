'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
  carrierName?: string;
}

interface Props {
  order:           Order;
  currency:        string;
  carriers:        { name: string }[];
  shippingDetails: ShippingDetails | null;
  shippingProvider: string;
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

  const [status, setStatus]               = useState<OrderStatus>(order.status);
  const [carrier, setCarrier]             = useState(originalCarrier);
  const [pendingCarrier, setPendingCarrier] = useState<string | null>(null);
  const [showConfirm, setShowConfirm]     = useState(false);
  const [trackingCode, setTrackingCode]   = useState(order.tracking_code ?? '');
  const [notes, setNotes]                 = useState(order.notes ?? '');
  const [saving, setSaving]               = useState(false);
  const [saveMsg, setSaveMsg]             = useState<string | null>(null);
  const [saveError, setSaveError]         = useState(false);
  const [markingPaid, setMarkingPaid]     = useState(false);
  const [paidMsg, setPaidMsg]             = useState<string | null>(null);
  const [paidError, setPaidError]         = useState(false);
  const [isPaid, setIsPaid]               = useState(!isInStorePending);

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

  async function handleMarkAsPaid() {
    setMarkingPaid(true);
    setPaidMsg(null);
    setPaidError(false);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ payment_status: 'paid' }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      setPaidMsg(t.markAsPaidOk);
      setIsPaid(true);
      router.refresh();
    } catch {
      setPaidMsg(t.markAsPaidError);
      setPaidError(true);
    } finally {
      setMarkingPaid(false);
    }
  }

  const inputClass =
    'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]';

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
          <button
            onClick={handleMarkAsPaid}
            disabled={markingPaid}
            className="w-full py-2.5 rounded-lg font-semibold text-white text-sm disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: '#D97706' }}
          >
            {markingPaid ? t.markingAsPaid : t.markAsPaid}
          </button>
          {paidMsg && (
            <p className={`text-sm mt-2 ${paidError ? 'text-red-600' : 'text-green-700'}`}>
              {paidMsg}
            </p>
          )}
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
            disabled={saving}
            className="w-full py-2.5 rounded-lg font-semibold text-white text-sm disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {saving ? t.saving : t.save}
          </button>
        </div>
      </section>

      {/* Section 5 — Print */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
        >
          <span>🖨</span> {t.print}
        </button>
      </section>
    </>
  );
}
