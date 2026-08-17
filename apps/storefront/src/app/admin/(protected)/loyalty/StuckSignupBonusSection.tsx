'use client';

import { useState } from 'react';
import Button from '../../_components/ui/Button';
import type { StuckSignupBonus } from '@/lib/loyalty/getStuckSignupBonuses';

// Même panneau admin "en révision" que PendingReviewSection — section/onglet
// séparé plutôt qu'une nouvelle page, même structure tabulaire.
export function StuckSignupBonusSection({ initialItems }: { initialItems: StuckSignupBonus[] }) {
  const [items, setItems] = useState(initialItems);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleConfirm(customerId: string) {
    setPendingId(customerId);
    try {
      const res = await fetch('/api/admin/loyalty/confirm-signup-bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((i) => i.customerId !== customerId));
      }
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
        Bonus de bienvenue en attente
      </h2>
      <p className="text-xs text-gray-400 mb-4">
        Bonus de parrainage (SIGNUP_BONUS) restés PENDING plus de 7 jours. Une ligne en rouge signifie
        que le client a déjà une commande livrée — le bonus aurait dû se confirmer automatiquement et
        ne l&apos;a pas fait ; à confirmer manuellement après vérification.
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-gray-400">Aucun bonus bloqué.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 uppercase tracking-wide">
                <th className="py-1.5 font-medium">Client</th>
                <th className="py-1.5 font-medium">Date bonus</th>
                <th className="py-1.5 font-medium">Montant</th>
                <th className="py-1.5 font-medium">Commande livrée ?</th>
                <th className="py-1.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.ledgerEntryId}
                  className={`border-t border-gray-100 dark:border-gray-800 ${item.hasDeliveredOrder ? 'bg-red-50 dark:bg-red-950/30' : ''}`}
                >
                  <td className="py-2">
                    <div className="font-medium text-gray-800 dark:text-gray-100">{item.customerFullName ?? '—'}</div>
                    <div className="text-gray-400">{item.customerEmail}</div>
                  </td>
                  <td className="py-2 text-gray-500">{new Date(item.createdAt).toLocaleDateString('fr-FR')}</td>
                  <td className="py-2 font-medium">{item.amount} pts</td>
                  <td className="py-2">
                    {item.hasDeliveredOrder ? (
                      <span className="text-red-600 font-semibold">Oui — anomalie</span>
                    ) : (
                      <span className="text-gray-400">Pas encore</span>
                    )}
                  </td>
                  <td className="py-2">
                    <Button size="sm" onClick={() => handleConfirm(item.customerId)} loading={pendingId === item.customerId}>
                      Confirmer
                    </Button>
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
