'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconCircleCheck } from '@tabler/icons-react';
import type { Order } from '@lepefy/types';
import { shipmentDate, shipmentStatusLabel } from '@/lib/shipping/shipmentPresentation';
import CopyableValue from '../../_components/ui/CopyableValue';
import ShipmentDraftBlock from './ShipmentDraftBlock';

// Provider association panel: attach, sync, switch to manual tracking. The
// carrier details and the event history live in ShipmentTrackingCard.
export default function ManagedShipmentPanel({ order, provider, ready, canManage = true, draftCreation = false }: {
  order: Order; provider: { key: string; displayName: string }; ready: boolean; canManage?: boolean;
  /** Tenant creates provider drafts from Lepefy (shipping_automation, migration 151). */
  draftCreation?: boolean;
}) {
  const router = useRouter();
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manualConfirm, setManualConfirm] = useState(false);
  const [releaseConfirm, setReleaseConfirm] = useState(false);
  const associated = Boolean(order.shipping_provider_reference);
  const active = order.status === 'preparing' || order.status === 'shipped';
  const fromDraft = associated && order.shipping_creation_status === 'draft_created';
  const showDraft = draftCreation && !associated && (order.status === 'new' || order.status === 'preparing');
  // A draft deleted in the provider back-office can be detached (server re-verifies with the provider).
  const releasable = fromDraft && canManage && (order.status === 'new' || order.status === 'preparing')
    && ['pending', 'unknown', 'cancelled', ''].includes(order.shipping_normalized_status ?? '');
  const autoSync = active && !['returned', 'cancelled', 'delivered'].includes(order.shipping_normalized_status ?? '');
  async function request(action: 'attach' | 'sync' | 'manual' | 'release') {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/orders/${order.id}/shipment/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'attach' ? { providerReference: reference.trim() } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? 'Opération indisponible.');
      setMessage(action === 'manual' ? 'Suivi manuel activé.'
        : action === 'release' ? 'Référence retirée : vous pouvez recréer le brouillon.' : 'Expédition synchronisée.');
      setManualConfirm(false); setReleaseConfirm(false); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Opération indisponible.'); }
    finally { setBusy(false); }
  }
  const button = 'min-h-11 w-full rounded-xl border border-[var(--admin-border)] px-4 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] disabled:opacity-50';
  return (
    <section id="order-shipment" aria-labelledby="order-shipment-title" className="scroll-mt-24 space-y-3 rounded-2xl border border-[#D9D3FF] bg-white p-4 dark:bg-gray-900">
      <h2 id="order-shipment-title" className="text-[11px] font-bold uppercase tracking-wide text-[var(--admin-primary-fg)]">Expédition {provider.displayName}</h2>
      {associated ? (
        <>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><IconCircleCheck size={16} aria-hidden="true" /> {fromDraft ? `Brouillon ${provider.displayName} créé` : 'Expédition associée'}</p>
          <div className="space-y-1 text-xs">
            <CopyableValue label="Réf." value={order.shipping_provider_reference!} />
            {fromDraft && order.shipping_provider_created_at && <p className="text-gray-500 dark:text-gray-400">Créé depuis Lepefy le {shipmentDate(order.shipping_provider_created_at)}</p>}
            <p className="text-gray-500 dark:text-gray-400">Statut transporteur : <span className="font-medium text-gray-800 dark:text-gray-100">{shipmentStatusLabel(order.shipping_normalized_status)}</span></p>
            <p className="text-gray-500 dark:text-gray-400">Dernière synchro : {shipmentDate(order.shipping_provider_synced_at)}</p>
          </div>
          {order.shipping_sync_error && <p role="status" className="text-xs text-amber-800 dark:text-amber-300">La dernière synchronisation a échoué. Les dernières données connues sont conservées.</p>}
          <p className="text-xs text-gray-500">{autoSync ? 'Synchronisation automatique active' : 'Suivi terminé'}</p>
          {active && canManage && <button disabled={busy} onClick={() => void request('sync')} className={button}>{busy ? 'Synchronisation…' : 'Synchroniser maintenant'}</button>}
          {releasable && (releaseConfirm ? (
            <div className="space-y-2 rounded-xl border border-amber-200 p-3">
              <p className="text-xs text-amber-800 dark:text-amber-200">Lepefy vérifie auprès de {provider.displayName} que le brouillon {order.shipping_provider_reference} a bien été supprimé, puis retire la référence de la commande. Rien n’est supprimé chez le transporteur.</p>
              <button disabled={busy} onClick={() => void request('release')} className={button}>{busy ? 'Vérification…' : 'Vérifier et retirer la référence'}</button>
              <button disabled={busy} onClick={() => setReleaseConfirm(false)} className={button}>Annuler</button>
            </div>
          ) : <button disabled={busy} onClick={() => setReleaseConfirm(true)} className="min-h-11 w-full text-xs font-medium text-gray-500 underline">Brouillon supprimé dans {provider.displayName} PRO ? Recréer</button>)}
        </>
      ) : (
        <>
          {showDraft && <ShipmentDraftBlock order={order} providerName={provider.displayName} canManage={canManage} />}
          {!canManage
            ? (showDraft ? null : <p className="text-sm text-gray-500">Aucune expédition associée.</p>)
            : ready && active ? (
              <form onSubmit={event => { event.preventDefault(); if (!busy) void request('attach'); }} className="space-y-3">
                <label htmlFor="provider-reference" className="block text-sm">Référence {provider.displayName}</label>
                <input id="provider-reference" value={reference} onChange={event => setReference(event.target.value)} maxLength={100} required autoComplete="off"
                  className="min-h-11 w-full rounded-lg border border-[var(--admin-border)] bg-transparent px-3 text-sm focus:ring-2 focus:ring-[var(--admin-primary)]" />
                <button disabled={busy || !reference.trim()} className={`${button} bg-[var(--admin-primary)] text-white`}>{busy ? 'Vérification…' : 'Vérifier et associer'}</button>
              </form>
            ) : showDraft ? null : <p className="text-sm text-gray-500">Terminez la préparation, les contrôles froid et l’emballage avant d’associer une expédition.</p>}
          <p className="text-xs text-gray-500">Le transporteur, le tracking et les statuts seront récupérés automatiquement.</p>
        </>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
      {active && canManage && (manualConfirm ? (
        <div className="space-y-2 rounded-xl border border-amber-200 p-3">
          <p className="text-xs text-amber-800">Le suivi automatique sera désactivé pour cette commande. Vous devrez mettre à jour son tracking et son statut manuellement.</p>
          <button disabled={busy} onClick={() => void request('manual')} className={button}>Confirmer le suivi manuel</button>
          <button disabled={busy} onClick={() => setManualConfirm(false)} className={button}>Conserver le suivi automatique</button>
        </div>
      ) : <button disabled={busy} onClick={() => setManualConfirm(true)} className="min-h-11 w-full text-xs font-medium text-gray-500 underline">Utiliser un suivi manuel</button>)}
    </section>
  );
}
