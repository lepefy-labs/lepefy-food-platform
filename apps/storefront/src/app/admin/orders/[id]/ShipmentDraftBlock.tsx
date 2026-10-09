'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconAlertTriangle, IconClock, IconLoader2 } from '@tabler/icons-react';
import type { Order } from '@lepefy/types';
import {
  SHIPMENT_CREATION_STATUS_LABELS, shipmentDraftErrorMessage, shipmentOrderReference,
} from '@/lib/shipping/shipmentDraft/shipmentDraftPresentation';

/**
 * Draft provisioning state for an order without provider reference
 * (POST /api/admin/orders/[id]/shipment/create). Creating a draft never ships
 * the order: tracking takes over once the reference is stored.
 */
export default function ShipmentDraftBlock({ order, providerName, canManage }: {
  order: Order; providerName: string; canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const [confirmRecreate, setConfirmRecreate] = useState(false);
  const state = order.shipping_creation_status ?? 'not_required';
  const error = shipmentDraftErrorMessage(order.shipping_creation_error);
  const orderReference = shipmentOrderReference(order.id);

  async function submit(body: Record<string, unknown>) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/admin/orders/${order.id}/shipment/create`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null) as { error?: string; reference?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? 'Création indisponible.');
      setMessage(`Brouillon ${providerName} créé : ${data?.reference ?? ''}`);
      setConfirmRecreate(false); setReference('');
    } catch (failure) {
      setMessage(failure instanceof Error ? failure.message : 'Création indisponible.');
    } finally { setBusy(false); router.refresh(); }
  }

  const button = 'min-h-11 w-full rounded-xl border border-[var(--admin-border)] px-4 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] disabled:opacity-50';
  const primary = `${button} bg-[var(--admin-primary)] text-white`;

  return (
    <div className="space-y-2" aria-live="polite">
      {state === 'not_required' && <p className="text-sm text-gray-600 dark:text-gray-300">{SHIPMENT_CREATION_STATUS_LABELS.not_required}</p>}
      {state === 'pending' && (
        <p className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200"><IconClock size={16} aria-hidden="true" /> {SHIPMENT_CREATION_STATUS_LABELS.pending} <span className="text-xs text-gray-500">· automatique sous 15 min</span></p>
      )}
      {state === 'creating' && (
        <p className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200"><IconLoader2 size={16} className="animate-spin" aria-hidden="true" /> {SHIPMENT_CREATION_STATUS_LABELS.creating}</p>
      )}
      {state === 'failed' && (
        <div role="status" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
          <p className="font-semibold">{SHIPMENT_CREATION_STATUS_LABELS.failed}</p>
          {error && <p className="mt-1 text-xs">{error}</p>}
        </div>
      )}
      {(state === 'ambiguous' || state === 'draft_created') && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="flex items-center gap-1.5 font-semibold"><IconAlertTriangle size={16} aria-hidden="true" /> {SHIPMENT_CREATION_STATUS_LABELS.ambiguous}</p>
          {error && <p className="mt-1 text-xs">{error}</p>}
          <p className="mt-1 text-xs">Cherchez « {orderReference} » dans {providerName} PRO avant toute nouvelle création.</p>
        </div>
      )}

      {canManage && (state === 'not_required' || state === 'pending' || state === 'failed') && (
        <button type="button" disabled={busy} onClick={() => void submit({})} className={primary}>
          {busy ? 'Création…' : state === 'failed' ? 'Réessayer' : state === 'pending' ? 'Créer maintenant' : `Créer le brouillon ${providerName}`}
        </button>
      )}
      {canManage && (state === 'ambiguous' || state === 'draft_created') && (
        <div className="space-y-2">
          <form onSubmit={(event) => { event.preventDefault(); if (!busy && reference.trim()) void submit({ providerReference: reference.trim() }); }} className="space-y-2">
            <label htmlFor="draft-reference" className="block text-xs text-gray-600 dark:text-gray-300">Référence trouvée dans {providerName} PRO</label>
            <input id="draft-reference" value={reference} onChange={(event) => setReference(event.target.value)} maxLength={100} autoComplete="off"
              className="min-h-11 w-full rounded-lg border border-[var(--admin-border)] bg-transparent px-3 text-sm focus:ring-2 focus:ring-[var(--admin-primary)]" />
            <button disabled={busy || !reference.trim()} className={primary}>{busy ? 'Vérification…' : 'Associer la référence'}</button>
          </form>
          {confirmRecreate ? (
            <div className="space-y-2 rounded-xl border border-amber-200 p-3">
              <p className="text-xs text-amber-800 dark:text-amber-200">Confirmez qu’aucun brouillon « {orderReference} » n’existe dans {providerName} PRO : sinon la commande aura deux brouillons.</p>
              <button type="button" disabled={busy} onClick={() => void submit({ confirmNoExistingDraft: true })} className={button}>Aucun brouillon : recréer</button>
              <button type="button" disabled={busy} onClick={() => setConfirmRecreate(false)} className={button}>Annuler</button>
            </div>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirmRecreate(true)} className="min-h-11 w-full text-xs font-medium text-gray-500 underline">Aucun brouillon trouvé ?</button>
          )}
        </div>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
      <p className="text-xs text-gray-500">Lepefy crée uniquement un brouillon : l’achat se fait dans {providerName} PRO.</p>
    </div>
  );
}
