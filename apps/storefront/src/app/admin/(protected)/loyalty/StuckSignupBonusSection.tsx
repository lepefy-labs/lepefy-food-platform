'use client';

import { useState } from 'react';
import Button from '../../_components/ui/Button';
import type { StuckSignupBonus } from '@/lib/loyalty/getStuckSignupBonuses';

// Même panneau admin "en révision" que PendingReviewSection — section/onglet
// séparé plutôt qu'une nouvelle page, même structure tabulaire.
export function StuckSignupBonusSection({ initialItems }: { initialItems: StuckSignupBonus[] }) {
  const [items, setItems] = useState(initialItems);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  async function handleConfirm(customerId: string) {
    setPendingId(customerId);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/loyalty/confirm-signup-bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setMessage({ text: body?.error ?? 'Confirmation impossible.', tone: 'error' });
        return;
      }
      setItems((prev) => prev.filter((i) => i.customerId !== customerId));
      setMessage({ text: 'Bonus confirmé.', tone: 'ok' });
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="bg-a-surface rounded-xl border border-a-border p-5">
      <h2 className="text-sm font-semibold text-a-text-2 mb-1">
        Bonus de bienvenue en attente
      </h2>
      <p className="text-xs text-a-text-3 mb-4">
        Bonus d’inscription par parrainage restés en attente plus de 7 jours. Une ligne en rouge signifie
        que le client a déjà une commande livrée — le bonus aurait dû se confirmer automatiquement et
        ne l&apos;a pas fait ; à confirmer manuellement après vérification.
      </p>

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-3 py-2 text-xs ${message.tone === 'ok' ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-tone-danger-bg text-tone-danger-fg'}`}>{message.text}</p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-a-text-3">Aucun bonus bloqué.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-a-text-3 uppercase tracking-wide">
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
                  className={`border-t border-a-border ${item.hasDeliveredOrder ? 'bg-tone-danger-bg' : ''}`}
                >
                  <td className="py-2">
                    <div className="font-medium text-a-text">{item.customerFullName ?? '—'}</div>
                    <div className="text-a-text-3">{item.customerEmail}</div>
                  </td>
                  <td className="py-2 text-a-text-3">{new Date(item.createdAt).toLocaleDateString('fr-FR')}</td>
                  <td className="py-2 font-medium">{item.amount} pts</td>
                  <td className="py-2">
                    {item.hasDeliveredOrder ? (
                      <span className="text-tone-danger-fg font-semibold">Oui — anomalie</span>
                    ) : (
                      <span className="text-a-text-3">Pas encore</span>
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
