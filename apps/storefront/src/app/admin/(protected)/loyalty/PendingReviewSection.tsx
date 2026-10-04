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
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">En révision{entries.length > 0 ? ` (${entries.length})` : ''}</h2>
      <p className="text-xs text-gray-400 mb-4">
        Points signalés par l&apos;anti-fraude (mode « Signaler pour revue manuelle ») : ils restent en attente tant qu&apos;ils ne sont pas confirmés ici.
      </p>

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-3 py-2 text-xs ${message.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{message.text}</p>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-gray-400">Aucune ligne en attente de revue.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400">
                <th className="py-1.5 font-medium">Date</th>
                <th className="py-1.5 font-medium">Bénéficiaire</th>
                <th className="py-1.5 font-medium">Origine</th>
                <th className="py-1.5 font-medium">Points</th>
                <th className="py-1.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-2 text-gray-500">{new Date(e.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="py-2">
                    <Link href={`/admin/clients/${e.customer_id}`} className="font-medium text-gray-800 hover:underline dark:text-gray-100">
                      {customerNames[e.customer_id] ?? 'Client'}
                    </Link>
                  </td>
                  <td className="py-2 text-gray-600 dark:text-gray-300">
                    {pointTypeLabel(e.transaction_type)}{e.referral_level ? ` · niveau ${e.referral_level}` : ''}
                    {e.reference_customer_id && <span className="block text-gray-400">filleul : {customerNames[e.reference_customer_id] ?? 'client'}</span>}
                    {e.reference_order_id && (
                      <Link href={`/admin/orders/${e.reference_order_id}`} className="block text-gray-400 hover:underline">
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
