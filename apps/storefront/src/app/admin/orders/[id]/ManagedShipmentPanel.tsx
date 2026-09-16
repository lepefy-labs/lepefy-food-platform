'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Order } from '@lepefy/types';
import { shipmentDate, shipmentStatusLabel } from '@/lib/shipping/shipmentPresentation';

export default function ManagedShipmentPanel({ order, provider, ready }: {
  order: Order; provider: { key: string; displayName: string }; ready: boolean;
}) {
  const router = useRouter();
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manualConfirm, setManualConfirm] = useState(false);
  const associated = Boolean(order.shipping_provider_reference);
  const active = order.status === 'preparing' || order.status === 'shipped';
  async function request(action: 'attach' | 'sync' | 'manual') {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/orders/${order.id}/shipment/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'attach' ? { providerReference: reference.trim() } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? 'Opération indisponible.');
      setMessage(action === 'manual' ? 'Suivi manuel activé.' : 'Expédition synchronisée.');
      setManualConfirm(false); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Opération indisponible.'); }
    finally { setBusy(false); }
  }
  const button = 'min-h-11 w-full rounded-xl border border-[var(--admin-border)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50';
  return (
    <section className="space-y-4 rounded-2xl border border-[#D9D3FF] bg-white p-4 dark:bg-gray-900">
      <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--admin-primary-fg)]">Expédition {provider.displayName}</h2>
      {associated ? (
        <>
          <p className="text-sm font-semibold text-emerald-700">✓ Expédition trouvée</p>
          <dl className="space-y-2 text-sm">
            {[
              ['Prestataire', provider.displayName], ['Référence', order.shipping_provider_reference],
              ['Transporteur', order.tracking_carrier], ['Tracking', order.tracking_code],
              ['Statut', shipmentStatusLabel(order.shipping_normalized_status)],
              ['Livraison estimée', order.shipping_estimated_delivery_at ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'Europe/Rome' }).format(new Date(order.shipping_estimated_delivery_at)) : '—'],
              ['Dernière synchro', shipmentDate(order.shipping_provider_synced_at)],
            ].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-gray-500">{label}</dt><dd className="min-w-0 break-all text-right">{value ?? '—'}</dd></div>)}
          </dl>
          {order.shipping_sync_error && <p role="status" className="text-xs text-amber-700">La dernière synchronisation a échoué. Les dernières données connues sont conservées.</p>}
          <p className="text-xs text-gray-500">{active && !['returned', 'cancelled', 'delivered'].includes(order.shipping_normalized_status ?? '') ? 'Synchronisation automatique active' : 'Suivi terminé'}</p>
          {active && <button disabled={busy} onClick={() => void request('sync')} className={button}>{busy ? 'Synchronisation…' : 'Synchroniser maintenant'}</button>}
        </>
      ) : (
        <>
          {ready && active ? (
            <form onSubmit={event => { event.preventDefault(); if (!busy) void request('attach'); }} className="space-y-3">
              <label htmlFor="provider-reference" className="block text-sm">Référence {provider.displayName}</label>
              <input id="provider-reference" value={reference} onChange={event => setReference(event.target.value)} maxLength={100} required autoComplete="off"
                className="min-h-11 w-full rounded-lg border border-[var(--admin-border)] bg-transparent px-3 text-sm focus:ring-2 focus:ring-[var(--admin-primary)]" />
              <button disabled={busy || !reference.trim()} className={`${button} bg-[var(--admin-primary)] text-white`}>{busy ? 'Vérification…' : 'Vérifier et associer'}</button>
            </form>
          ) : <p className="text-sm text-gray-500">Terminez le picking, les contrôles froid et le packing avant d’associer une expédition.</p>}
          <p className="text-xs text-gray-500">Le transporteur, le tracking et les statuts seront récupérés automatiquement.</p>
        </>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
      {active && (manualConfirm ? (
        <div className="space-y-2 rounded-xl border border-amber-200 p-3">
          <p className="text-xs text-amber-800">Le suivi automatique sera désactivé pour cette commande. Vous devrez mettre à jour son tracking et son statut manuellement.</p>
          <button disabled={busy} onClick={() => void request('manual')} className={button}>Confirmer le suivi manuel</button>
          <button disabled={busy} onClick={() => setManualConfirm(false)} className={button}>Conserver le suivi automatique</button>
        </div>
      ) : <button disabled={busy} onClick={() => setManualConfirm(true)} className="min-h-11 w-full text-xs font-medium text-gray-500 underline">Utiliser un suivi manuel</button>)}
    </section>
  );
}
