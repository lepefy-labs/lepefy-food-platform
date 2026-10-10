'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/utils/format';
import {
  ambassadorDisplayName,
  defaultPayoutReference,
  payoutState,
  type PayoutDestination,
} from '@/lib/ambassador/ambassadorAdmin';
import Button from '../../_components/ui/Button';
import Dialog from '../../_components/ui/Dialog';
import { ErrorText } from '../../_components/ui/InlineAlert';
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
    <Dialog
      open
      onClose={onClose}
      dismissible={!isSaving}
      size="sm"
      title={`Verser ${formatPrice(candidate.balance, currency)} à ${name}`}
      description={`${candidate.commissionIds.length} commission${candidate.commissionIds.length > 1 ? 's' : ''} confirmée${candidate.commissionIds.length > 1 ? 's' : ''}`}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={isSaving}>Annuler</Button>
        <Button onClick={() => void confirm()} loading={isSaving}>J&apos;ai effectué le versement</Button>
      </>}
    >
      <div className="space-y-3 text-sm">
        <ol className="list-decimal space-y-1 pl-4 text-a-text-2">
          <li>Faites le virement depuis votre banque ou PayPal.</li>
          <li>Revenez ici et confirmez : les commissions passent en « Versée ».</li>
        </ol>
        <div className="space-y-1 rounded-lg bg-a-surface-2 px-3 py-2 text-xs">
          <CopyableValue label="Bénéficiaire" value={name} />
          {candidate.destination && <CopyableValue label={candidate.destination.label} value={candidate.destination.value} />}
          <CopyableValue label="Montant" value={candidate.balance.toFixed(2)} />
        </div>
        <div>
          <label htmlFor="payout-note" className="mb-1.5 block text-sm font-semibold text-a-text">Référence du virement</label>
          <input id="payout-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-a-border-strong bg-a-surface px-3 py-2 text-sm text-a-text placeholder:text-a-text-3 focus:outline focus:outline-2 focus:outline-a-focus" />
        </div>
        <ErrorText message={error} />
      </div>
    </Dialog>
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
