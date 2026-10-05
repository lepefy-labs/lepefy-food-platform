'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconX } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import {
  ambassadorDisplayName,
  defaultPayoutReference,
  payoutState,
  type PayoutDestination,
} from '@/lib/ambassador/ambassadorAdmin';
import Button from '../../_components/ui/Button';
import CopyableValue from '../../_components/ui/CopyableValue';

export interface PayoutCandidate {
  id: string;
  email: string;
  full_name: string | null;
  ambassador_first_name: string | null;
  ambassador_last_name: string | null;
  profileComplete: boolean;
  balance: number;
  commissionIds: string[];
  destination: PayoutDestination | null;
}

function PayoutModal({ candidate, currency, onClose, onDone }: {
  candidate: PayoutCandidate;
  currency: string;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const titleId = useId();
  const [note, setNote] = useState(() => defaultPayoutReference(candidate, new Date()));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = ambassadorDisplayName(candidate);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  async function confirm() {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ambassador/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ambassadorId: candidate.id, commissionIds: candidate.commissionIds, paymentNote: note }),
      });
      const body = await res.json().catch(() => null) as { error?: string; paidCount?: number; paidTotal?: number; skippedCount?: number } | null;
      if (!res.ok) {
        setError(body?.error ?? 'Versement impossible.');
        return;
      }
      const skipped = body?.skippedCount ? ` ${body.skippedCount} commission${body.skippedCount > 1 ? 's' : ''} déjà traitée${body.skippedCount > 1 ? 's' : ''} ignorée${body.skippedCount > 1 ? 's' : ''}.` : '';
      onDone(`Versement de ${formatPrice(body?.paidTotal ?? 0, currency)} enregistré pour ${name} (${body?.paidCount ?? 0} commission${(body?.paidCount ?? 0) > 1 ? 's' : ''}).${skipped}`);
    } catch {
      setError('Erreur réseau — réessayez.');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(e) => { if (e.key === 'Escape' && !isSaving) onClose(); }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !isSaving) onClose(); }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-gray-950 dark:text-gray-100">Verser {formatPrice(candidate.balance, currency)} à {name}</h2>
            <p className="mt-0.5 text-xs text-gray-500">{candidate.commissionIds.length} commission{candidate.commissionIds.length > 1 ? 's' : ''} confirmée{candidate.commissionIds.length > 1 ? 's' : ''}</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} aria-label="Fermer" className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <IconX size={16} />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          <ol className="list-decimal space-y-1 pl-4 text-xs text-gray-600 dark:text-gray-300">
            <li>Faites le virement depuis votre banque ou PayPal.</li>
            <li>Revenez ici et confirmez : les commissions passent en « Versée ».</li>
          </ol>
          <div className="space-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-800">
            <CopyableValue label="Bénéficiaire" value={name} />
            {candidate.destination && <CopyableValue label={candidate.destination.label} value={candidate.destination.value} />}
            <CopyableValue label="Montant" value={candidate.balance.toFixed(2)} />
          </div>
          <div>
            <label htmlFor="payout-note" className="mb-1 block text-xs font-medium text-gray-500">Référence du virement</label>
            <input
              id="payout-note"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-gray-800">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving}>Annuler</Button>
          <Button size="sm" onClick={() => void confirm()} loading={isSaving}>J&apos;ai effectué le versement</Button>
        </div>
      </div>
    </div>
  );
}

export function PayoutsSection({ candidates, payoutThreshold, currency }: {
  candidates: PayoutCandidate[];
  payoutThreshold: number;
  currency: string;
}) {
  const router = useRouter();
  const [active, setActive] = useState<PayoutCandidate | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const total = candidates.reduce((sum, c) => sum + c.balance, 0);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
        À verser{candidates.length > 0 ? ` · ${formatPrice(total, currency)}` : ''}
      </h2>
      <p className="mb-4 text-xs text-gray-400">
        Aucun versement automatique : vous payez par virement ou PayPal, puis vous l&apos;enregistrez ici.
        Seuil conseillé : {formatPrice(payoutThreshold, currency)}.
      </p>

      {message && <p role="status" className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">{message}</p>}

      {candidates.length === 0 ? (
        <p className="text-sm text-gray-400">Aucune commission à verser.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {candidates.map((c) => {
            const state = payoutState(c.balance, payoutThreshold, c.profileComplete);
            return (
              <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-xs">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{ambassadorDisplayName(c)}</p>
                  <p className="text-gray-500">
                    {formatPrice(c.balance, currency)} · {c.commissionIds.length} commission{c.commissionIds.length > 1 ? 's' : ''}
                    {c.destination && <> · {c.destination.label} {c.destination.masked}</>}
                  </p>
                  {state === 'profile_incomplete' && (
                    <p className="text-amber-700">Profil incomplet : l&apos;ambassadeur doit renseigner nom, prénom et IBAN ou PayPal dans son compte.</p>
                  )}
                  {state === 'below_threshold' && <p className="text-gray-400">Sous le seuil conseillé.</p>}
                  {state === 'ready' && <p className="font-medium text-green-700">Prêt à verser</p>}
                </div>
                <Button
                  size="sm"
                  variant={state === 'ready' ? 'primary' : 'outline'}
                  disabled={state === 'profile_incomplete'}
                  onClick={() => { setMessage(null); setActive(c); }}
                >
                  Verser {formatPrice(c.balance, currency)}…
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {active && (
        <PayoutModal
          candidate={active}
          currency={currency}
          onClose={() => setActive(null)}
          onDone={(text) => { setActive(null); setMessage(text); router.refresh(); }}
        />
      )}
    </section>
  );
}
