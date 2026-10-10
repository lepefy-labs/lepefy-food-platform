'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconArrowDown, IconCheck, IconPackage, IconSnowflake, IconTemperature } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { orderDetailTransition } from '@/lib/orders/adminOrderOperations';
import { carrierDisplayName } from '@/lib/shipping/shipmentPresentation';
import ConfirmPaymentButton from '../../_components/ui/ConfirmPaymentButton';
import ConfirmDialog from '../../_components/ui/ConfirmDialog';
import PackingPanel from './PackingPanel';
import ManagedShipmentPanel from './ManagedShipmentPanel';
import CartonSuggestionCard from './CartonSuggestionCard';
import OrderDocumentsCard, { type OrderDocumentsDefaults } from './OrderDocumentsCard';
import type { CartonSuggestion } from '@/lib/shipping/cartonSuggestion';
import type { Order } from '@lepefy/types';

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

/** Guidance shown when the next step happens in another panel (no duplicated mutation). */
export interface NextStepGuide { label: string; hint: string; href: string }

interface Props {
  order: Order;
  currency: string;
  carriers: { name: string }[];
  shippingDetails: ShippingDetails | null;
  shippingProvider: string;
  managedProvider?: { key: string; displayName: string } | null;
  /** Tenant creates provider shipment drafts from Lepefy (migration 151). */
  draftCreation?: boolean;
  coldChain?: { fresh: number; frozen: number };
  pickingProgress: PickingProgress;
  cartonSuggestion?: CartonSuggestion | null;
  missingWeightLines?: number;
  canManage: boolean;
  nextStep?: NextStepGuide | null;
  documents: OrderDocumentsDefaults;
}

function formatCarrierName(raw: string | undefined): string {
  return carrierDisplayName(raw) ?? '—';
}

function Field({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-sm ${bold ? 'font-semibold' : ''}`}>
      <span className="shrink-0 text-xs text-a-text-3">{label}</span>
      <span className="text-right text-a-text-2">{value}</span>
    </div>
  );
}

const secondaryButton = 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-a-border px-3 py-2 text-sm font-semibold text-a-text-2 hover:bg-a-surface-2 focus-visible:outline-2 focus-visible:outline-a-focus disabled:opacity-50';

export default function OrderDetail({
  order,
  currency,
  carriers,
  shippingDetails,
  shippingProvider,
  managedProvider,
  draftCreation = false,
  coldChain = { fresh: 0, frozen: 0 },
  pickingProgress,
  cartonSuggestion = null,
  missingWeightLines = 0,
  canManage,
  nextStep = null,
  documents,
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
  // Provider refreshes may update snapshots while the form component remains mounted.
  useEffect(() => {
    setCarrier(originalCarrier);
    setTrackingCode(order.tracking_code ?? '');
  }, [originalCarrier, order.tracking_code]);

  const managed = !isPickup && order.shipping_tracking_mode !== 'manual' && Boolean(managedProvider);
  const action = orderDetailTransition(order, managed);
  const needsTracking = action?.status === 'shipped';
  const finishingPreparation = order.status === 'preparing'
    && (action?.status === 'shipped' || action?.status === 'ready_for_pickup');
  const pickingBlocked = finishingPreparation && !pickingProgress.complete;
  const packingProgress = {
    parcelCount: order.packing_parcel_count,
    complete: Boolean(order.packing_completed_at && order.packing_parcel_count && order.packing_parcel_count > 0),
  };
  const packingBlocked = order.status === 'preparing' && action?.status === 'shipped' && !packingProgress.complete;
  const actionDisabled = saving || (needsTracking && !trackingCode.trim()) || pickingBlocked || packingBlocked;
  const blockReason = pickingBlocked
    ? 'Terminez la checklist de préparation (lignes et contrôles froid).'
    : packingBlocked ? 'Validez d’abord l’emballage (nombre de colis).'
      : needsTracking && !trackingCode.trim() ? 'Renseignez le code de suivi.' : null;
  const hasColdChain = coldChain.fresh > 0 || coldChain.frozen > 0;
  const terminal = order.status === 'delivered' || order.status === 'cancelled';
  const inputClass = 'w-full rounded-lg border border-a-border bg-a-surface px-3 py-2.5 text-sm text-a-text focus:outline-none focus:ring-2 focus:ring-a-focus read-only:bg-a-surface-2';

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

  // Manual tracking fields (shown in the action panel) are saved with the note, without any status change.
  const editsLogistics = Boolean(action) && !isPickup && !managed;
  const unchanged = notes === (order.notes ?? '')
    && (!editsLogistics || (carrier === originalCarrier && trackingCode === (order.tracking_code ?? '')));

  async function saveInformation() {
    await patchOrder({
      notes: notes.trim() || null,
      ...(editsLogistics ? { tracking_carrier: carrier.trim() || null, tracking_code: trackingCode.trim() || null } : {}),
    }, 'Informations enregistrées.');
  }

  async function runPrimaryAction() {
    if (!action) return;
    await patchOrder({
      status: action.status,
      notes: notes.trim() || null,
      ...(!isPickup && !managed ? {
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
  const suggestedCarrierLabel = shippingProvider === 'packlink' ? 'Transporteur suggéré' : 'Transporteur par défaut';

  return (
    <>
      {!canManage && (
        <p role="status" className="rounded-xl border border-a-border bg-a-surface-2 px-3 py-2.5 text-xs text-a-text-2">
          <strong>Lecture seule.</strong> La gestion de la commande nécessite le droit « commandes : gérer ».
        </p>
      )}

      {canManage && action && (
        <section id="order-actions-panel" aria-labelledby="order-next-action-title" className="scroll-mt-24 overflow-hidden rounded-2xl border border-a-border bg-a-brand-soft shadow-sm">
          <div className="border-b border-a-border px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wide text-a-brand-fg">Prochaine action</p>
            <h2 id="order-next-action-title" className="mt-1 text-base font-semibold text-a-text">{action.label}</h2>
            <p className="mt-1 text-xs text-a-text-3">La transition reste contrôlée côté serveur.</p>
          </div>

          <div className="space-y-4 bg-a-surface p-4">
            {finishingPreparation && (
              <div className={`rounded-xl border p-3 ${pickingProgress.complete
                ? 'border-tone-success-border bg-tone-success-bg'
                : 'border-tone-warning-border bg-tone-warning-bg'
              }`}>
                <div className="flex items-center justify-between gap-3">
                  <p className={`text-xs font-bold uppercase tracking-wide ${pickingProgress.complete ? 'text-tone-success-fg' : 'text-tone-warning-fg'}`}>Préparation</p>
                  <span className="text-xs font-semibold text-a-text-2">{pickingProgress.picked}/{pickingProgress.total}</span>
                </div>
                {pickingProgress.complete ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-tone-success-fg">
                    <IconCheck size={14} aria-hidden="true" /> Préparation et contrôles froid terminés.
                  </p>
                ) : (
                  <p className="mt-2 text-xs leading-5 text-tone-warning-fg">
                    <a href="#picking-checklist" className="font-semibold underline">Terminez la checklist</a> avant de finaliser la commande.
                    {pickingProgress.coldRequired > 0 && ` Contrôles froid : ${pickingProgress.coldChecked}/${pickingProgress.coldRequired}.`}
                  </p>
                )}
              </div>
            )}

            {needsTracking && (
              <p className={`flex items-center gap-1.5 text-xs font-semibold ${packingProgress.complete ? 'text-tone-success-fg' : 'text-a-brand-fg'}`}>
                <IconPackage size={14} aria-hidden="true" />
                {packingProgress.complete
                  ? `Emballage validé${packingProgress.parcelCount != null ? ` · ${packingProgress.parcelCount} colis` : ''}.`
                  : <>Emballage à valider dans <a href="#order-packing" className="underline">le panneau Emballage</a>.</>}
              </p>
            )}

            {hasColdChain && !terminal && (
              <div className="rounded-xl border border-tone-info-border bg-tone-info-bg p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-tone-info-fg">Chaîne du froid</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {coldChain.frozen > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-tone-info-bg px-2.5 py-1 text-xs font-semibold text-tone-info-fg">
                      <IconSnowflake size={14} aria-hidden="true" /> {coldChain.frozen} surgelé{coldChain.frozen > 1 ? 's' : ''}
                    </span>
                  )}
                  {coldChain.fresh > 0 && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-tone-info-bg px-2.5 py-1 text-xs font-semibold text-tone-info-fg">
                      <IconTemperature size={14} aria-hidden="true" /> {coldChain.fresh} frais
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs leading-5 text-tone-info-fg">Le contrôle froid de chaque ligne doit être validé avant la remise ou l&apos;expédition.</p>
              </div>
            )}

            {!isPickup && !managed && (
              <>
                <div>
                  <label htmlFor="order-carrier" className="mb-1.5 block text-xs font-medium text-a-text-3">Transporteur effectif</label>
                  <select id="order-carrier" value={carrier} onChange={event => setCarrier(event.target.value)} className={inputClass}>
                    {carrier && !carriers.some(item => item.name === carrier) && <option value={carrier}>{carrier}</option>}
                    {carriers.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
                  </select>
                  {packlinkCarrier && <p className="mt-1 text-xs text-a-text-3">{suggestedCarrierLabel} : {formatCarrierName(packlinkCarrier)}</p>}
                </div>
                <div>
                  <label htmlFor="order-tracking-code" className="mb-1.5 block text-xs font-medium text-a-text-3">Code de suivi</label>
                  <input id="order-tracking-code" type="text" value={trackingCode} onChange={event => setTrackingCode(event.target.value)} placeholder="Numéro de suivi du colis" className={inputClass} />
                </div>
              </>
            )}

            <button type="button" onClick={runPrimaryAction} disabled={actionDisabled} aria-describedby={blockReason ? 'order-action-block' : undefined}
              className="min-h-11 w-full rounded-xl bg-a-brand px-4 py-2.5 text-sm font-semibold text-a-on-brand transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-focus disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? 'Mise à jour…' : action.label}
            </button>
            {blockReason && <p id="order-action-block" className="text-xs font-medium text-tone-warning-fg">{blockReason}</p>}
            {saveMsg && <p role="status" className={`text-xs font-medium ${saveError ? 'text-tone-danger-fg' : 'text-tone-success-fg'}`}>{saveMsg}</p>}
          </div>
        </section>
      )}

      {canManage && !action && nextStep && (
        <section aria-labelledby="order-next-step-title" className="rounded-2xl border border-a-border bg-a-brand-soft p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-a-brand-fg">Prochaine action</p>
          <h2 id="order-next-step-title" className="mt-1 text-base font-semibold text-a-text">{nextStep.label}</h2>
          <p className="mt-1 text-xs text-a-text-2">{nextStep.hint}</p>
          <a href={nextStep.href} className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-a-surface px-3 text-xs font-semibold text-a-brand-fg ring-1 ring-a-border focus-visible:outline-2 focus-visible:outline-a-focus">
            Aller à la section <IconArrowDown size={14} aria-hidden="true" />
          </a>
        </section>
      )}

      {!isPickup && order.status === 'preparing' && (
        <PackingPanel
          orderId={order.id}
          status={order.status}
          pickingComplete={pickingProgress.complete}
          hasColdChain={hasColdChain}
          estimatedParcels={shippingDetails?.numParcels ?? null}
          initialParcelCount={order.packing_parcel_count}
          initialColdChecked={Boolean(order.cold_chain_packing_checked_at)}
          initialComplete={packingProgress.complete}
          readOnly={!canManage}
        />
      )}

      {!isPickup && cartonSuggestion && ['new', 'preparing'].includes(order.status) && (
        <CartonSuggestionCard suggestion={cartonSuggestion} missingWeightLines={missingWeightLines} />
      )}

      {managed && managedProvider && (order.status !== 'new' || draftCreation) && order.status !== 'cancelled' && (
        <ManagedShipmentPanel order={order} provider={managedProvider} ready={pickingProgress.complete && packingProgress.complete} canManage={canManage} draftCreation={draftCreation} />
      )}

      {order.payment_method === 'in_store' && !isPaid && (
        <section id="order-payment" className="scroll-mt-24 rounded-xl border border-tone-warning-border bg-tone-warning-bg p-4">
          <p className="mb-3 text-sm font-semibold text-tone-warning-fg">Paiement en attente — à encaisser en boutique</p>
          {canManage && (
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
          )}
        </section>
      )}

      {!isPickup && sd && (
        <section aria-labelledby="order-shipping-costs-title" className="rounded-xl border border-a-border bg-a-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 id="order-shipping-costs-title" className="text-sm font-semibold text-a-text">Coûts d’expédition</h2>
            {sd.freeShippingApplied && <span className="rounded-full bg-tone-success-bg px-2 py-1 text-xs font-bold text-tone-success-fg">Livraison offerte</span>}
          </div>
          <div className="space-y-2">
            {sd.carrierName && <Field label="Transporteur prévu" value={formatCarrierName(sd.carrierName)} />}
            {sd.serviceName && <Field label="Service" value={sd.serviceName} />}
            {sd.numParcels != null && <Field label="Colis estimés" value={String(sd.numParcels)} />}
            {order.packing_parcel_count != null && <Field label="Colis préparés" value={String(order.packing_parcel_count)} bold />}
            {sd.totalWeightG != null && <Field label="Poids total" value={`${(sd.totalWeightG / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`} />}
            {sd.packlinkCost != null && <Field label="Coût transporteur" value={formatPrice(sd.packlinkCost, currency)} />}
            {sd.vatAmount != null && <Field label="TVA livraison" value={formatPrice(sd.vatAmount, currency)} />}
            {sd.packagingSurchargeTotal != null && sd.packagingSurchargeTotal > 0 && <Field label="Surplus emballage" value={formatPrice(sd.packagingSurchargeTotal, currency)} />}
            {sd.discountApplied != null && sd.discountApplied > 0 && <Field label="Remise livraison" value={`-${formatPrice(sd.discountApplied, currency)}`} />}
            <div className="border-t border-a-border pt-2">
              <Field label="Total livraison facturé" value={formatPrice(order.shipping_cost, currency)} bold />
            </div>
          </div>
        </section>
      )}

      <section aria-labelledby="order-notes-title" className="rounded-xl border border-a-border bg-a-surface p-4">
        <label id="order-notes-title" htmlFor="order-notes" className="mb-3 block text-sm font-semibold text-a-text">Notes internes</label>
        <textarea id="order-notes" value={notes} onChange={event => setNotes(event.target.value)} readOnly={!canManage}
          placeholder={canManage ? 'Visible uniquement par l’équipe' : 'Aucune note'} rows={4} className={`${inputClass} resize-none`} />
        {canManage && <button type="button" onClick={saveInformation} disabled={saving || unchanged} className={`mt-3 ${secondaryButton}`}>{editsLogistics ? 'Enregistrer la note et le suivi' : 'Enregistrer la note'}</button>}
        {!action && saveMsg && <p role="status" className={`mt-2 text-xs font-medium ${saveError ? 'text-tone-danger-fg' : 'text-tone-success-fg'}`}>{saveMsg}</p>}
      </section>

      <section aria-labelledby="order-documents-title" className="rounded-xl border border-a-border bg-a-surface p-4">
        <h2 id="order-documents-title" className="mb-3 text-xs font-bold uppercase tracking-wide text-a-text-3">Documents</h2>
        <div className="space-y-3">
          <OrderDocumentsCard orderId={order.id} cancelled={order.status === 'cancelled'} defaults={documents} />
          {canManage && !['cancelled', 'delivered', 'shipped'].includes(order.status) && (
            <button type="button" onClick={() => setCancelOpen(true)} disabled={saving}
              className="min-h-11 w-full rounded-lg border border-tone-danger-border px-3 py-2 text-sm font-semibold text-tone-danger-fg hover:bg-tone-danger-bg focus-visible:outline-2 focus-visible:outline-tone-danger-solid disabled:opacity-50">
              Annuler la commande
            </button>
          )}
        </div>
      </section>

      <ConfirmDialog
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
