'use client';

import { useState } from 'react';
import Link from 'next/link';
import Button from '../../_components/ui/Button';
import { pointTypeLabel } from '@/lib/admin/crmLabels';
import type { PointsLedgerEntry } from '@lepefy/types';

export function PendingReviewSection({ initialEntries, customerNames }: {
  initialEntries: PointsLedgerEntry[];
  /** customer id → display name, resolved server-side for every row. */
  customerNames: Record<string, string>;
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  async function handleConfirm(entry: PointsLedgerEntry) {
    setPendingId(entry.id);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/loyalty/confirm-reviewed-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ledgerEntryId: entry.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setMessage({ text: body?.error ?? 'Confirmation impossible.', tone: 'error' });
        return;
      }
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      setMessage({ text: `+${entry.amount} pts confirmés pour ${customerNames[entry.customer_id] ?? 'le client'}.`, tone: 'ok' });
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="bg-a-surface rounded-xl border border-a-border p-5">
      <h2 className="text-sm font-semibold text-a-text-2 mb-1">En révision{entries.length > 0 ? ` (${entries.length})` : ''}</h2>
      <p className="text-xs text-a-text-3 mb-4">
        Points signalés par l&apos;anti-fraude (mode « Signaler pour revue manuelle ») : ils restent en attente tant qu&apos;ils ne sont pas confirmés ici.
      </p>

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-3 py-2 text-xs ${message.tone === 'ok' ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-tone-danger-bg text-tone-danger-fg'}`}>{message.text}</p>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-a-text-3">Aucune ligne en attente de revue.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-a-text-3">
                <th className="py-1.5 font-medium">Date</th>
                <th className="py-1.5 font-medium">Bénéficiaire</th>
                <th className="py-1.5 font-medium">Origine</th>
                <th className="py-1.5 font-medium">Points</th>
                <th className="py-1.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-a-border">
                  <td className="py-2 text-a-text-3">{new Date(e.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="py-2">
                    <Link href={`/admin/clients/${e.customer_id}`} className="font-medium text-a-text hover:underline">
                      {customerNames[e.customer_id] ?? 'Client'}
                    </Link>
                  </td>
                  <td className="py-2 text-a-text-2">
                    {pointTypeLabel(e.transaction_type)}{e.referral_level ? ` · niveau ${e.referral_level}` : ''}
                    {e.reference_customer_id && <span className="block text-a-text-3">filleul : {customerNames[e.reference_customer_id] ?? 'client'}</span>}
                    {e.reference_order_id && (
                      <Link href={`/admin/orders/${e.reference_order_id}`} className="block text-a-text-3 hover:underline">
                        commande #{e.reference_order_id.slice(0, 8).toUpperCase()}
                      </Link>
                    )}
                  </td>
                  <td className="py-2 font-medium">+{e.amount} pts</td>
                  <td className="py-2">
                    <Button size="sm" onClick={() => void handleConfirm(e)} loading={pendingId === e.id}>Confirmer</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
