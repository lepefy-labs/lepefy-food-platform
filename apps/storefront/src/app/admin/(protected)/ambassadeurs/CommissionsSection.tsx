'use client';

import { useState } from 'react';
import { formatPrice } from '@/lib/utils/format';
import type { AmbassadorCommissionStatus } from '@lepefy/types';

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
  status: AmbassadorCommissionStatus;
  payment_note: string | null;
  created_at: string;
  ambassador: JoinedCustomer | null;
  referred: JoinedCustomer | null;
}

const STATUS_LABELS: Record<AmbassadorCommissionStatus, string> = {
  CONFIRMED: 'Confirmée',
  PAID: 'Payée',
  CANCELLED: 'Annulée',
};

function ambassadorName(a: JoinedCustomer | null): string {
  if (!a) return '—';
  if (a.ambassador_first_name && a.ambassador_last_name) return `${a.ambassador_first_name} ${a.ambassador_last_name}`;
  return a.full_name ?? a.email;
}

export function CommissionsSection({ initialCommissions, currency }: { initialCommissions: CommissionRow[]; currency: string }) {
  const [commissions, setCommissions] = useState(initialCommissions);
  const [statusFilter, setStatusFilter] = useState<AmbassadorCommissionStatus | 'ALL'>('CONFIRMED');
  const [isLoading, setIsLoading] = useState(false);
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleFilterChange(next: AmbassadorCommissionStatus | 'ALL') {
    setStatusFilter(next);
    setIsLoading(true);
    try {
      const qs = next === 'ALL' ? '' : `?status=${next}`;
      const res = await fetch(`/api/admin/ambassador/commissions${qs}`);
      const data = await res.json();
      setCommissions(data.commissions ?? []);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleMarkPaid(id: string) {
    setPendingId(id);
    try {
      const res = await fetch(`/api/admin/ambassador/commissions/${id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentNote: notesById[id] ?? '' }),
      });
      if (res.ok) {
        setCommissions((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'PAID' as const } : c)));
      }
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Commissions</h2>
        <select
          value={statusFilter}
          onChange={(e) => handleFilterChange(e.target.value as AmbassadorCommissionStatus | 'ALL')}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700"
        >
          <option value="CONFIRMED">Confirmées</option>
          <option value="PAID">Payées</option>
          <option value="CANCELLED">Annulées</option>
          <option value="ALL">Toutes</option>
        </select>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Une commission par client invité (au premier ordre livré), calculée sur le montant payé après réduction.
      </p>

      {isLoading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : commissions.length === 0 ? (
        <p className="text-sm text-gray-400">Aucune commission dans ce filtre.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 uppercase tracking-wide">
                <th className="py-1.5 font-medium">Date</th>
                <th className="py-1.5 font-medium">Ambassadeur</th>
                <th className="py-1.5 font-medium">Client invité</th>
                <th className="py-1.5 font-medium">Payé / réduction</th>
                <th className="py-1.5 font-medium">Commission</th>
                <th className="py-1.5 font-medium">Statut</th>
                <th className="py-1.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {commissions.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 dark:border-gray-800 align-top">
                  <td className="py-2 text-gray-500">{new Date(c.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="py-2 font-medium text-gray-800 dark:text-gray-100">{ambassadorName(c.ambassador)}</td>
                  <td className="py-2 text-gray-600 dark:text-gray-300">
                    {c.referred?.full_name ?? c.referred?.email ?? '—'}
                  </td>
                  <td className="py-2 text-gray-500">
                    {formatPrice(c.order_amount_paid, currency)}
                    {c.discount_applied > 0 && (
                      <span className="text-amber-600"> (−{formatPrice(c.discount_applied, currency)})</span>
                    )}
                  </td>
                  <td className="py-2 font-bold text-gray-800 dark:text-gray-100">
                    {formatPrice(c.commission_amount, currency)}
                  </td>
                  <td className="py-2">
                    <span className={
                      c.status === 'PAID' ? 'text-green-600' : c.status === 'CANCELLED' ? 'text-red-500' : 'text-amber-600'
                    }>
                      {STATUS_LABELS[c.status]}
                    </span>
                    {c.status === 'PAID' && c.payment_note && (
                      <div className="text-gray-400 mt-0.5">{c.payment_note}</div>
                    )}
                  </td>
                  <td className="py-2">
                    {c.status === 'CONFIRMED' && (
                      <div className="flex flex-col gap-1 min-w-[140px]">
                        <input
                          type="text"
                          placeholder="Référence virement (optionnel)"
                          value={notesById[c.id] ?? ''}
                          onChange={(e) => setNotesById((prev) => ({ ...prev, [c.id]: e.target.value }))}
                          className="border border-gray-200 rounded-lg px-2 py-1 text-xs"
                        />
                        <button
                          onClick={() => handleMarkPaid(c.id)}
                          disabled={pendingId === c.id}
                          className="px-2.5 py-1 rounded-lg text-white bg-[var(--color-primary)] disabled:opacity-50"
                        >
                          Marquer comme payé
                        </button>
                      </div>
                    )}
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
