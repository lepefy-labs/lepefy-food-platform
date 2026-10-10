'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/utils/format';
import {
  ambassadorDisplayName,
  CANCEL_REASON_MIN,
  COMMISSION_STATUS_LABELS,
} from '@/lib/ambassador/ambassadorAdmin';
import Button from '../../_components/ui/Button';
import Dialog from '../../_components/ui/Dialog';
import { ErrorText } from '../../_components/ui/InlineAlert';
import type { AmbassadorCommissionMode, AmbassadorCommissionStatus } from '@lepefy/types';

interface JoinedCustomer {
  email: string;
  full_name: string | null;
  ambassador_first_name?: string | null;
  ambassador_last_name?: string | null;
}

export interface CommissionRow {
  id: string;
  order_id: string;
  order_subtotal: number;
  order_amount_paid: number;
  discount_applied: number;
  commission_amount: number;
  commission_mode?: AmbassadorCommissionMode;
  status: AmbassadorCommissionStatus;
  payment_note: string | null;
  paid_at?: string | null;
  created_at: string;
  ambassador: JoinedCustomer | null;
  referred: JoinedCustomer | null;
}

type Filter = AmbassadorCommissionStatus | 'ALL';

const STATUS_TONE: Record<AmbassadorCommissionStatus, string> = {
  CONFIRMED: 'text-amber-700',
  PAID: 'text-green-700',
  CANCELLED: 'text-gray-400 line-through',
};

function CancelModal({ row, currency, onClose, onDone }: {
  row: CommissionRow;
  currency: string;
  onClose: () => void;
  onDone: (updated: CommissionRow) => void;
}) {
  const [reason, setReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = reason.trim().length >= CANCEL_REASON_MIN;

  async function confirm() {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/ambassador/commissions/${row.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await res.json().catch(() => null) as { error?: string; payment_note?: string } | null;
      if (!res.ok) {
        setError(body?.error ?? 'Annulation impossible.');
        return;
      }
      onDone({ ...row, status: 'CANCELLED', payment_note: body?.payment_note ?? null });
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
      title={`Annuler la commission de ${formatPrice(row.commission_amount, currency)} ?`}
      description={<>À utiliser si la commande de {row.referred?.full_name || row.referred?.email || 'ce client'} a été remboursée ou retournée. La commission ne sera pas versée et ce client ne pourra plus en générer une autre. Action définitive.</>}
      footer={<>
        <Button variant="secondary" onClick={onClose} disabled={isSaving}>Retour</Button>
        <Button variant="danger" onClick={() => void confirm()} loading={isSaving} disabled={!valid}>Annuler la commission</Button>
      </>}
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="cancel-reason" className="mb-1.5 block text-sm font-semibold text-a-text">Motif (obligatoire)</label>
          <textarea id="cancel-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex. commande remboursée le 12/10" className="w-full rounded-lg border border-a-border-strong bg-a-surface px-3 py-2 text-sm text-a-text placeholder:text-a-text-3 focus:outline focus:outline-2 focus:outline-a-focus" />
        </div>
        <ErrorText message={error} />
      </div>
    </Dialog>
  );
}

export function CommissionsSection({ initialCommissions, currency, canManagePayouts }: {
  initialCommissions: CommissionRow[];
  currency: string;
  canManagePayouts: boolean;
}) {
  const router = useRouter();
  const [commissions, setCommissions] = useState(initialCommissions);
  const [filter, setFilter] = useState<Filter>('CONFIRMED');
  const [isLoading, setIsLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CommissionRow | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  async function changeFilter(next: Filter) {
    setFilter(next);
    setIsLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/ambassador/commissions${next === 'ALL' ? '' : `?status=${next}`}`);
      const data = await res.json().catch(() => null) as { commissions?: CommissionRow[]; error?: string } | null;
      if (!res.ok) {
        setMessage({ text: data?.error ?? 'Chargement impossible.', tone: 'error' });
        return;
      }
      setCommissions(data?.commissions ?? []);
    } catch {
      setMessage({ text: 'Erreur réseau — réessayez.', tone: 'error' });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Commissions</h2>
        <label htmlFor="commission-filter" className="sr-only">Filtrer par statut</label>
        <select
          id="commission-filter"
          value={filter}
          onChange={(e) => void changeFilter(e.target.value as Filter)}
          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700"
        >
          <option value="CONFIRMED">À verser</option>
          <option value="PAID">Versées</option>
          <option value="CANCELLED">Annulées</option>
          <option value="ALL">Toutes</option>
        </select>
      </div>
      <p className="mb-4 text-xs text-gray-400">
        Une commission par client invité, créée quand sa première commande passe en « Livrée ». Elle se verse depuis « À verser »
        ; annulez-la si la commande est remboursée.
      </p>

      {message && (
        <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-3 py-2 text-xs ${message.tone === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{message.text}</p>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : commissions.length === 0 ? (
        <p className="text-sm text-gray-400">Aucune commission dans ce filtre.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400">
                <th className="py-1.5 font-medium">Date</th>
                <th className="py-1.5 font-medium">Ambassadeur</th>
                <th className="py-1.5 font-medium">Client invité · commande</th>
                <th className="py-1.5 font-medium">Payé (réduction)</th>
                <th className="py-1.5 font-medium">Commission</th>
                <th className="py-1.5 font-medium">Statut</th>
                {canManagePayouts && <th className="py-1.5 font-medium"><span className="sr-only">Action</span></th>}
              </tr>
            </thead>
            <tbody>
              {commissions.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 align-top dark:border-gray-800">
                  <td className="py-2 text-gray-500">{new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="py-2 font-medium text-gray-800 dark:text-gray-100">{c.ambassador ? ambassadorDisplayName(c.ambassador) : 'Compte supprimé'}</td>
                  <td className="py-2 text-gray-600 dark:text-gray-300">
                    {c.referred?.full_name || c.referred?.email || 'Compte supprimé'}
                    <Link href={`/admin/orders/${c.order_id}`} className="block text-gray-400 hover:underline">
                      #{c.order_id.slice(0, 8).toUpperCase()}
                    </Link>
                  </td>
                  <td className="py-2 text-gray-500">
                    {formatPrice(c.order_amount_paid, currency)}
                    {Number(c.discount_applied) > 0 && <span className="text-amber-700"> (−{formatPrice(c.discount_applied, currency)})</span>}
                  </td>
                  <td className="py-2 font-semibold text-gray-800 dark:text-gray-100">
                    {formatPrice(c.commission_amount, currency)}
                    {c.commission_mode === 'SPLIT_POOL' && <span className="block font-normal text-gray-400">pool</span>}
                  </td>
                  <td className="py-2">
                    <span className={STATUS_TONE[c.status]}>{COMMISSION_STATUS_LABELS[c.status]}</span>
                    {c.status === 'PAID' && c.paid_at && <div className="text-gray-400">le {new Date(c.paid_at).toLocaleDateString('fr-FR')}</div>}
                    {c.payment_note && c.status !== 'CONFIRMED' && <div className="max-w-[16rem] text-gray-400">{c.payment_note}</div>}
                  </td>
                  {canManagePayouts && (
                    <td className="py-2 text-right">
                      {c.status === 'CONFIRMED' && (
                        <Button variant="outline" size="sm" onClick={() => { setMessage(null); setCancelTarget(c); }}>Annuler…</Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cancelTarget && (
        <CancelModal
          row={cancelTarget}
          currency={currency}
          onClose={() => setCancelTarget(null)}
          onDone={(updated) => {
            setCancelTarget(null);
            setCommissions((prev) => (filter === 'CONFIRMED'
              ? prev.filter((c) => c.id !== updated.id)
              : prev.map((c) => (c.id === updated.id ? updated : c))));
            setMessage({ text: `Commission de ${formatPrice(updated.commission_amount, currency)} annulée.`, tone: 'ok' });
            router.refresh();
          }}
        />
      )}
    </section>
  );
}
