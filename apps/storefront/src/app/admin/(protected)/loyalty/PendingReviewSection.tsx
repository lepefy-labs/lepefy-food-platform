'use client';

import { useState } from 'react';
import type { PointsLedgerEntry } from '@lepefy/types';

export function PendingReviewSection({ initialEntries }: { initialEntries: PointsLedgerEntry[] }) {
  const [entries, setEntries] = useState(initialEntries);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleConfirm(ledgerEntryId: string) {
    setPendingId(ledgerEntryId);
    try {
      const res = await fetch('/api/admin/loyalty/confirm-reviewed-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ledgerEntryId }),
      });
      if (res.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== ledgerEntryId));
      }
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">En révision</h2>
      <p className="text-xs text-gray-400 mb-4">
        Lignes de points signalées par l&apos;anti-fraude (mode &quot;Signaler pour revue manuelle&quot;) —
        restent en attente tant qu&apos;elles ne sont pas confirmées ici.
      </p>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-400">Aucune ligne en attente de revue.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 uppercase tracking-wide">
                <th className="py-1.5 font-medium">Date</th>
                <th className="py-1.5 font-medium">Type</th>
                <th className="py-1.5 font-medium">Niveau</th>
                <th className="py-1.5 font-medium">Montant</th>
                <th className="py-1.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="py-2 text-gray-500">{new Date(e.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="py-2">{e.transaction_type}</td>
                  <td className="py-2">{e.referral_level ?? '—'}</td>
                  <td className="py-2 font-medium">{e.amount} pts</td>
                  <td className="py-2">
                    <button
                      onClick={() => handleConfirm(e.id)}
                      disabled={pendingId === e.id}
                      className="px-2.5 py-1 rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50"
                    >
                      Confirmer
                    </button>
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
