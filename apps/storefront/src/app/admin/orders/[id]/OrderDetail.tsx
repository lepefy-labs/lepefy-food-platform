'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/utils/format';
import ConfirmPaymentButton from '../../_components/ui/ConfirmPaymentButton';
import type { Order, OrderStatus } from '@lepefy/types';

interface ShippingDetails {
  totalWeightG?: number;
  numParcels?: number;
  packlinkCost?: number;
  serviceName?: string;
  carrierName?: string;
  vatSource?: 'packlink' | 'db';
  vatRate?: number;
  vatAmount?: number;
  packagingSurchargeTotal?: number;
  discountApplied?: number;
  freeShippingApplied?: boolean;
}

interface Props {
  order: Order;
  currency: string;
  carriers: { name: string }[];
  shippingDetails: ShippingDetails | null;
  shippingProvider: string;
}

const CARRIER_MAP: Record<string, string> = {
  brt: 'BRT', bartolini: 'BRT', dhl: 'DHL', fedex: 'FedEx', tnt: 'TNT',
  gls: 'GLS', ups: 'UPS', sda: 'SDA', poste: 'Poste Italiane',
  'poste italiane': 'Poste Italiane', dpd: 'DPD', nexive: 'Nexive',
};

function formatCarrierName(raw: string | undefined): string {
  if (!raw) return '—';
  return CARRIER_MAP[raw.toLowerCase().trim()] ?? raw.trim();
}

function nextAction(status: OrderStatus, isPickup: boolean) {
  if (status === 'new') return { status: 'preparing' as OrderStatus, label: 'Démarrer la préparation' };
  if (status === 'preparing') {
    return isPickup
      ? { status: 'ready_for_pickup' as OrderStatus, label: 'Marquer prête au retrait' }
      : { status: 'shipped' as OrderStatus, label: 'Expédier la commande' };
  }
  if (status === 'ready_for_pickup' && isPickup) {
    return { status: 'delivered' as OrderStatus, label: 'Marquer comme retirée' };
  }
  if (status === 'shipped' && !isPickup) {
    return { status: 'delivered' as OrderStatus, label: 'Marquer comme livrée' };
  }
  return null;
}

function Field({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-sm ${bold ? 'font-semibold' : ''}`}>
      <span className="shrink-0 text-xs text-gray-400">{label}</span>
      <span className="text-right text-gray-700 dark:text-gray-200">{value}</span>
    </div>
  );
}

export default function OrderDetail({
  order,
  currency,
  carriers,
  shippingDetails,
  shippingProvider,
}: Props) {
  const router = useRouter();
  const isPickup = order.fulfillment_type === 'pickup';
  const isInStorePending = order.payment_method === 'in_store' && order.payment_status === 'pending';
  const packlinkCarrier = shippingDetails?.carrierName ?? '';
  const originalCarrier = order.tracking_carrier ?? packlinkCarrier ?? carriers[0]?.name ?? '';

  const [carrier, setCarrier] = useState(originalCarrier);
  const [trackingCode, setTrackingCode] = useState(order.tracking_code ?? '');
  const [notes, setNotes] = useState(order.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [isPaid, setIsPaid] = useState(!isInStorePending);

  const action = nextAction(order.status, isPickup);
  const needsTracking = action?.status === 'shipped';
  const actionDisabled = saving || (needsTracking && !trackingCode.trim());
  const inputClass = 'w-full rounded-lg border border-[var(--admin-border)] bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:bg-gray-950 dark:text-gray-100';

  async function patchOrder(body: Record<string, unknown>, successMessage: string) {
    setSaving(true);
    setSaveMsg(null);
    setSaveError(false);
    try {
      const res = await fetch(`/api/admin/orders/${order.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const response = await res.json().catch(() => null);
      if (!res.ok) throw new Error(response?.error ?? `HTTP ${res.status}`);
      setSaveMsg(successMessage);
      router.refresh();
    } catch (error) {
      setSaveMsg(error instanceof Error ? error.message : 'Erreur lors de la mise à jour.');
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  async function saveNotesAndLogistics() {
    await patchOrder({
      notes: notes.trim() || null,
      ...(!isPickup ? {
        tracking_carrier: carrier.trim() || null,
        tracking_code: trackingCode.trim() || null,
      } : {}),
    }, 'Modifications enregistrées.');
  }

  async function runPrimaryAction() {
    if (!action) return;
    await patchOrder({
      status: action.status,
      notes: notes.trim() || null,
      ...(!isPickup ? {
        tracking_carrier: carrier.trim() || null,
        tracking_code: trackingCode.trim() || null,
      } : {}),
    }, 'Commande mise à jour.');
  }

  async function cancelOrder() {
    await patchOrder({ status: 'cancelled', notes: notes.trim() || null }, 'Commande annulée.');
  }

  const sd = shippingDetails;
  const suggestedCarrierLabel = shippingProvider === 'packlink'
    ? 'Transporteur suggéré'
    : 'Transporteur par défaut';

  return (
    <>
      {order.payment_method === 'in_store' && !isPaid && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="mb-3 text-sm font-semibold text-amber-800 dark:text-amber-200">
            Paiement en attente — à encaisser en boutique
          </p>
          <ConfirmPaymentButton
            endpoint={`/api/admin/orders/${order.id}`}
            method="PATCH"
            body={{ payment_status: 'paid' }}
            label="Marquer comme payé"
            confirmingLabel="Mise à jour…"
            onSuccess={() => {
              setIsPaid(true);
              router.refresh();
            }}
          />
        </section>
      )}

      {action && (
        <section className="overflow-hidden rounded-2xl border border-[#D9D3FF] bg-[var(--admin-primary-soft)] shadow-sm">
          <div className="border-b border-[#D9D3FF] px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--admin-primary-fg)]">Action suivante</p>
            <h2 className="mt-1 text-base font-semibold text-gray-950 dark:text-gray-100">{action.label}</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Le workflow contrôle les transitions autorisées côté serveur.
            </p>
          </div>

          <div className="space-y-4 bg-white p-4 dark:bg-gray-900">
            {!isPickup && (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">Transporteur effectif</label>
                  <select value={carrier} onChange={event => setCarrier(event.target.value)} className={inputClass}>
                    {carrier && !carriers.some(item => item.name === carrier) && <option value={carrier}>{carrier}</option>}
                    {carriers.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
                  </select>
                  {packlinkCarrier && <p className="mt-1 text-[11px] text-gray-400">{suggestedCarrierLabel} : {formatCarrierName(packlinkCarrier)}</p>}
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">Code de suivi</label>
                  <input
                    type="text"
                    value={trackingCode}
                    onChange={event => setTrackingCode(event.target.value)}
                    placeholder="Numéro de tracking du colis"
                    className={inputClass}
                  />
                  {needsTracking && !trackingCode.trim() && (
                    <p className="mt-1.5 text-xs font-medium text-red-600">Le tracking est obligatoire avant expédition.</p>
                  )}
                </div>
              </>
            )}

            <button
              type="button"
              onClick={runPrimaryAction}
              disabled={actionDisabled}
              className="min-h-11 w-full rounded-xl bg-[var(--admin-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
            >
              {saving ? 'Mise à jour…' : action.label}
            </button>
          </div>
        </section>
      )}

      {!isPickup && sd && (
        <section className="rounded-xl border border-[var(--admin-border)] bg-white p-4 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Détails expédition</h2>
            {sd.freeShippingApplied && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">Livraison offerte</span>}
          </div>
          <div className="space-y-2">
            {sd.carrierName && <Field label="Transporteur" value={formatCarrierName(sd.carrierName)} />}
            {sd.serviceName && <Field label="Service" value={sd.serviceName} />}
            {sd.numParcels != null && <Field label="Nb colis" value={String(sd.numParcels)} />}
            {sd.totalWeightG != null && <Field label="Poids total" value={`${(sd.totalWeightG / 1000).toFixed(2)} kg`} />}
            {sd.packlinkCost != null && <Field label="Coût transporteur" value={formatPrice(sd.packlinkCost, currency)} />}
            {sd.vatAmount != null && <Field label="TVA livraison" value={formatPrice(sd.vatAmount, currency)} />}
            {sd.packagingSurchargeTotal != null && sd.packagingSurchargeTotal > 0 && <Field label="Surplus emballage" value={formatPrice(sd.packagingSurchargeTotal, currency)} />}
            {sd.discountApplied != null && sd.discountApplied > 0 && <Field label="Remise livraison" value={`-${formatPrice(sd.discountApplied, currency)}`} />}
            <div className="border-t border-gray-100 pt-2 dark:border-gray-800">
              <Field label="Total livraison facturé" value={formatPrice(order.shipping_cost, currency)} bold />
            </div>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-[var(--admin-border)] bg-white p-4 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">Notes internes</h2>
        <textarea
          value={notes}
          onChange={event => setNotes(event.target.value)}
          placeholder="Visible uniquement par l'équipe admin"
          rows={4}
          className={`${inputClass} resize-none`}
        />
        <button
          type="button"
          onClick={saveNotesAndLogistics}
          disabled={saving}
          className="mt-3 min-h-10 w-full rounded-lg border border-[var(--admin-border)] px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-[var(--admin-surface-subtle)] disabled:opacity-50 dark:text-gray-200"
        >
          Enregistrer les informations
        </button>
        {saveMsg && <p className={`mt-2 text-xs font-medium ${saveError ? 'text-red-600' : 'text-emerald-600'}`}>{saveMsg}</p>}
      </section>

      <section className="rounded-xl border border-[var(--admin-border)] bg-white p-4 dark:bg-gray-900">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-400">Actions secondaires</h2>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-10 w-full rounded-lg border border-[var(--admin-border)] px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-[var(--admin-surface-subtle)] dark:text-gray-200"
          >
            Imprimer la liste de prélèvement
          </button>
          {order.status !== 'cancelled' && order.status !== 'delivered' && order.status !== 'shipped' && (
            <button
              type="button"
              onClick={cancelOrder}
              disabled={saving}
              className="min-h-10 w-full rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950/30"
            >
              Annuler la commande
            </button>
          )}
        </div>
      </section>
    </>
  );
}
