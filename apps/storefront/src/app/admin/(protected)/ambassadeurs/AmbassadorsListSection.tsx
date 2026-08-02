'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatPrice } from '@/lib/utils/format';

export interface AmbassadorListRow {
  id: string;
  email: string;
  full_name: string | null;
  ambassador_first_name: string | null;
  ambassador_last_name: string | null;
  ambassador_payment_method: 'IBAN' | 'PAYPAL' | null;
  ambassador_profile_completed_at: string | null;
  promoted_to_ambassador_at: string | null;
  confirmedBalance: number;
  paidTotal: number;
}

interface AmbassadorsListSectionProps {
  ambassadors: AmbassadorListRow[];
  payoutThreshold: number;
  currency: string;
}

export function AmbassadorsListSection({ ambassadors, payoutThreshold, currency }: AmbassadorsListSectionProps) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function handleDemote(customerId: string) {
    setPendingId(customerId);
    try {
      const res = await fetch('/api/admin/ambassador/demote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId }),
      });
      if (res.ok) router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Ambassadeurs actifs</h2>
      <p className="text-xs text-gray-400 mb-4">
        Les profils incomplets accumulent quand même des commissions CONFIRMED — seul le paiement est bloqué tant
        que nom, prénom et un moyen de paiement ne sont pas renseignés.
      </p>

      {ambassadors.length === 0 ? (
        <p className="text-sm text-gray-400">Aucun ambassadeur pour l&apos;instant.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400 uppercase tracking-wide">
                <th className="py-1.5 font-medium">Ambassadeur</th>
                <th className="py-1.5 font-medium">Profil</th>
                <th className="py-1.5 font-medium">Solde confirmé</th>
                <th className="py-1.5 font-medium">Payé (total)</th>
                <th className="py-1.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {ambassadors.map((a) => {
                const displayName = a.ambassador_first_name && a.ambassador_last_name
                  ? `${a.ambassador_first_name} ${a.ambassador_last_name}`
                  : a.full_name ?? '—';
                const readyForPayout = a.confirmedBalance >= payoutThreshold;
                return (
                  <tr key={a.id} className="border-t border-gray-100 dark:border-gray-800">
                    <td className="py-2">
                      <div className="font-medium text-gray-800 dark:text-gray-100">{displayName}</div>
                      <div className="text-gray-400">{a.email}</div>
                    </td>
                    <td className="py-2">
                      {a.ambassador_profile_completed_at ? (
                        <span className="text-green-600">
                          Complet ({a.ambassador_payment_method === 'IBAN' ? 'IBAN' : 'PayPal'})
                        </span>
                      ) : (
                        <span className="text-amber-600">Profil incomplet</span>
                      )}
                    </td>
                    <td className="py-2">
                      <span className={readyForPayout ? 'font-bold text-green-700' : 'font-medium'}>
                        {formatPrice(a.confirmedBalance, currency)}
                      </span>
                      {readyForPayout && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-semibold">
                          À payer
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-gray-500">{formatPrice(a.paidTotal, currency)}</td>
                    <td className="py-2">
                      <button
                        onClick={() => handleDemote(a.id)}
                        disabled={pendingId === a.id}
                        className="px-2.5 py-1 rounded-lg border border-gray-200 text-gray-700 disabled:opacity-50"
                      >
                        Retirer le statut
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
