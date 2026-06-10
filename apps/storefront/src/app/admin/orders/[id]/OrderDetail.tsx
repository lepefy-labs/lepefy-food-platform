'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Order, OrderStatus } from '@lepefy/types';

// ─── Translations ─────────────────────────────────────────────────────────────

const translations = {
  fr: {
    updateOrder:      'Mettre à jour la commande',
    status:           'Statut',
    carrier:          'Transporteur effectif',
    tracking:         'Code de suivi',
    trackingHint:     'Numéro de tracking du colis',
    notes:            'Notes internes',
    notesHint:        'Visible uniquement par vous, pas par le client',
    save:             'Enregistrer',
    saving:           'Enregistrement…',
    saveOk:           '✓ Modifications enregistrées',
    saveError:        'Erreur lors de l\'enregistrement',
    print:            'Imprimer le récapitulatif',
    preparing:        'En préparation',
    shipped:          'Expédié',
    delivered:        'Livré',
    cancelled:        'Annulé',
    // Modal
    changeCarrier:   'Changer de transporteur ?',
    packlinkCarrier: 'Transporteur Packlink :',
    newCarrier:      'Nouveau transporteur :',
    cancel:          'Annuler',
    confirm:         'Confirmer',
  },
  it: {
    updateOrder:      'Aggiorna ordine',
    status:           'Stato',
    carrier:          'Corriere effettivo',
    tracking:         'Codice tracking',
    trackingHint:     'Numero di tracking del pacco',
    notes:            'Note interne',
    notesHint:        'Visibile solo a te, non al cliente',
    save:             'Salva',
    saving:           'Salvataggio…',
    saveOk:           '✓ Modifiche salvate',
    saveError:        'Errore durante il salvataggio',
    print:            'Stampa riepilogo',
    preparing:        'In preparazione',
    shipped:          'Spedito',
    delivered:        'Consegnato',
    cancelled:        'Annullato',
    // Modal
    changeCarrier:   'Cambiare corriere?',
    packlinkCarrier: 'Corriere Packlink:',
    newCarrier:      'Nuovo corriere:',
    cancel:          'Annulla',
    confirm:         'Conferma',
  },
} as const;

type Lang = keyof typeof translations;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShippingDetails {
  carrierName?: string;
}

interface Props {
  order:           Order;
  currency:        string;
  carriers:        { name: string }[];
  shippingDetails: ShippingDetails | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrderDetail({ order, currency, carriers, shippingDetails }: Props) {
  const router = useRouter();

  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('lepefy-admin-lang') as Lang) ?? 'fr';
    }
    return 'fr';
  });

  // Carrier — priority: tracking_carrier set manually > Packlink suggestion > first in list
  const packlinkCarrier = shippingDetails?.carrierName ?? '';
  const originalCarrier =
    order.tracking_carrier ??
    packlinkCarrier ??
    carriers[0]?.name ??
    '';

  const [status, setStatus]                     = useState<OrderStatus>(order.status);
  const [carrier, setCarrier]                   = useState(originalCarrier);
  const [pendingCarrier, setPendingCarrier]      = useState<string | null>(null);
  const [showConfirm, setShowConfirm]           = useState(false);
  const [trackingCode, setTrackingCode]         = useState(order.tracking_code ?? '');
  const [notes, setNotes]                       = useState(order.notes ?? '');
  const [saving, setSaving]                     = useState(false);
  const [saveMsg, setSaveMsg]                   = useState<string | null>(null);
  const [saveError, setSaveError]               = useState(false);

  const t = translations[lang];

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
      const res = await fetch(`/api/admin/orders/${order.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          tracking_carrier: carrier.trim() || null,
          tracking_code:    trackingCode.trim() || null,
          notes:            notes.trim() || null,
        }),
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
              <option value="preparing">{t.preparing}</option>
              <option value="shipped">{t.shipped}</option>
              <option value="delivered">{t.delivered}</option>
              <option value="cancelled">{t.cancelled}</option>
            </select>
          </div>

          {/* Carrier select */}
          <div style={{ position: 'relative' }}>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">{t.carrier}</label>

            {/* Confirmation modal — inline, no fixed positioning */}
            {showConfirm && (
              <div
                style={{
                  border: '1px solid #E5E7EB',
                  borderRadius: 10,
                  background: '#fff',
                  padding: '16px',
                  marginBottom: 8,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                }}
              >
                <p className="text-sm font-semibold text-gray-800 mb-3">{t.changeCarrier}</p>
                <div className="space-y-1.5 text-sm mb-4">
                  {packlinkCarrier && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-xs w-36 shrink-0">{t.packlinkCarrier}</span>
                      <span className="font-medium text-gray-700">{packlinkCarrier}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs w-36 shrink-0">{t.newCarrier}</span>
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
              {/* If current carrier isn't in list (manual entry from before), show it first */}
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
