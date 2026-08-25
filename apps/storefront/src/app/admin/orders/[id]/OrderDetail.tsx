'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconCheck, IconSnowflake, IconTemperature } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import ConfirmPaymentButton from '../../_components/ui/ConfirmPaymentButton';
import ConfirmActionModal from '../../_components/ui/ConfirmActionModal';
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

interface PickingProgress {
  total: number;
  picked: number;
  coldRequired: number;
  coldChecked: number;
  complete: boolean;
}

interface Props {
  order: Order;
  currency: string;
  carriers: { name: string }[];
  shippingDetails: ShippingDetails | null;
  shippingProvider: string;
  coldChain?: { fresh: number; frozen: number };
  pickingProgress: PickingProgress;
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
  coldChain = { fresh: 0, frozen: 0 },
  pickingProgress,
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
  const [cancelOpen, setCancelOpen] = useState(false);

  const action = nextAction(order.status, isPickup);
  const needsTracking = action?.status === 'shipped';
  const finishingPreparation = order.status === 'preparing'
    && (action?.status === 'shipped' || action?.status === 'ready_for_pickup');
  const pickingBlocked = finishingPreparation && !pickingProgress.complete;
  const actionDisabled = saving || (needsTracking && !trackingCode.trim()) || pickingBlocked;
  const hasColdChain = coldChain.fresh > 0 || coldChain.frozen > 0;
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
    setCancelOpen(false);
  }

  const sd = shippingDetails;
  const suggestedCarrierLabel = shippingProvider === 'packlink'
    ? 'Transporteur suggéré'
    : 'Transporteur par défaut';

  return (
    <>
      {action && (
        <section className="overflow-hidden rounded-2xl border border-[#D9D3FF] bg-[var(--admin-primary-soft)] shadow-sm">
          <div className="border-b border-[#D9D3FF] px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--admin-primary-fg)]">Prochaine action</p>
            <h2 className="mt-1 text-base font-semibold text-gray-950 dark:text-gray-100">{action.label}</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              La transition reste contrôlée côté serveur.
            </p>
          </div>

          <div className="space-y-4 bg-white p-4 dark:bg-gray-900">
            {finishingPreparation && (
              <div className={`rounded-xl border p-3 ${pickingProgress.complete
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
                : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'
              }`}>
                <div className="flex items-center justify-between gap-3">
                  <p className={`text-xs font-bold uppercase tracking-wide ${pickingProgress.complete ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-200'}`}>
                    Préparation
                  </p>
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{pickingProgress.picked}/{pickingProgress.total}</span>
                </div>
                {pickingProgress.complete ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    <IconCheck size={14} /> Picking et contrôles froid terminés.
                  </p>
                ) : (
                  <p className="mt-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
                    Terminez la checklist avant de finaliser la commande.
                    {pickingProgress.coldRequired > 0 && ` Contrôles froid : ${pickingProgress.coldChecked}/${pickingProgress.coldRequired}.`}
                  </p>
                )}
              </div>
            )}

            {hasColdChain && (
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/30">
                <p className="text-xs font-bold uppercase tracking-wide text-sky-800 dark:text-sky-200">Chaîne du froid</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {coldChain.frozen > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                      <IconSnowflake size={14} /> {coldChain.frozen} surgelé{coldChain.frozen > 1 ? 's' : ''}
                    </span>
                  )}
                  {coldChain.fresh > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-cyan-100 px-2.5 py-1 text-xs font-semibold text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200">
                      <IconTemperature size={14} /> {coldChain.fresh} frais
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs leading-5 text-sky-700 dark:text-sky-300">
                  Le contrôle froid de chaque ligne doit être validé avant la remise ou l&apos;expédition.
                </p>
              </div>
            )}

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
              className="min-h-11 w-full rounded-xl bg-[var(--admin-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Mise à jour…' : action.label}
            </button>
          </div>
        </section>
      )}

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

      {!isPickup && sd && (
        <section className="rounded-xl border border-[var(--admin-border)] bg-white p-4 dark:bg-gray-900">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Expédition & tracking</h2>
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
          className="mt-3 min-h-11 w-full rounded-lg border border-[var(--admin-border)] px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-[var(--admin-surface-subtle)] disabled:opacity-50 dark:text-gray-200"
        >
          Enregistrer les informations
        </button>
        {saveMsg && <p className={`mt-2 text-xs font-medium ${saveError ? 'text-red-600' : 'text-emerald-600'}`}>{saveMsg}</p>}
      </section>

      <section className="rounded-xl border border-[var(--admin-border)] bg-white p-4 dark:bg-gray-900">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-gray-400">Documents & actions secondaires</h2>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-11 w-full rounded-lg border border-[var(--admin-border)] px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-[var(--admin-surface-subtle)] dark:text-gray-200"
          >
            Imprimer la liste de prélèvement
          </button>
          {order.status !== 'cancelled' && order.status !== 'delivered' && order.status !== 'shipped' && (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              disabled={saving}
              className="min-h-11 w-full rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950/30"
            >
              Annuler la commande
            </button>
          )}
        </div>
      </section>

      <ConfirmActionModal
        open={cancelOpen}
        title="Annuler cette commande ?"
        description="La commande passera au statut annulé. Vérifiez le paiement et les éventuelles actions de remboursement avant de confirmer."
        confirmLabel="Annuler la commande"
        cancelLabel="Conserver"
        destructive
        loading={saving}
        onCancel={() => { if (!saving) setCancelOpen(false); }}
        onConfirm={() => { void cancelOrder(); }}
      />
    </>
  );
}
