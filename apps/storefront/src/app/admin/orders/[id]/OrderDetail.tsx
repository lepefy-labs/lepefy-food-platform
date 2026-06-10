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
    carrierHint:      'Nom du transporteur utilisé pour l\'envoi',
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
  },
  it: {
    updateOrder:      'Aggiorna ordine',
    status:           'Stato',
    carrier:          'Corriere effettivo',
    carrierHint:      'Nome del corriere usato per la spedizione',
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
  },
} as const;

type Lang = keyof typeof translations;

// ─── Component ────────────────────────────────────────────────────────────────

interface ShippingDetails {
  carrierName?: string;
}

export default function OrderDetail({
  order,
  currency,
}: {
  order: Order;
  currency: string;
}) {
  const router = useRouter();

  const [lang, setLang]                   = useState<Lang>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('lepefy-admin-lang') as Lang) ?? 'fr';
    }
    return 'fr';
  });
  const [status, setStatus]               = useState<OrderStatus>(order.status);
  const [carrier, setCarrier]             = useState(
    order.tracking_carrier ??
    ((order.shipping_details as ShippingDetails | null)?.carrierName ?? ''),
  );
  const [trackingCode, setTrackingCode]   = useState(order.tracking_code ?? '');
  const [notes, setNotes]                 = useState(order.notes ?? '');
  const [saving, setSaving]               = useState(false);
  const [saveMsg, setSaveMsg]             = useState<string | null>(null);
  const [saveError, setSaveError]         = useState(false);

  const t = translations[lang];

  function switchLang(l: Lang) {
    setLang(l);
    localStorage.setItem('lepefy-admin-lang', l);
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
      {/* Lang toggle — top right of section */}
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

          {/* Carrier */}
          <div>
            <label className="block text-xs text-gray-500 mb-1.5 font-medium">{t.carrier}</label>
            <input
              type="text"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder={t.carrierHint}
              className={inputClass}
            />
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
