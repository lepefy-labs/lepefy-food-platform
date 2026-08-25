'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconCheck,
  IconCircleCheck,
  IconMapPin,
  IconSnowflake,
  IconTemperature,
} from '@tabler/icons-react';
import type { OrderItem, OrderStatus } from '@lepefy/types';

interface Props {
  orderId: string;
  orderStatus: OrderStatus;
  items: OrderItem[];
}

function storageLabel(storageType: OrderItem['storage_type']) {
  if (storageType === 'frozen') return 'Surgelé';
  if (storageType === 'fresh') return 'Frais';
  return 'Sec';
}

export default function PickingChecklist({ orderId, orderStatus, items }: Props) {
  const router = useRouter();
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const progress = useMemo(() => {
    const cold = items.filter(item => item.storage_type === 'fresh' || item.storage_type === 'frozen');
    const picked = items.filter(item => item.picked_at).length;
    const coldChecked = cold.filter(item => item.cold_chain_checked_at).length;
    return {
      picked,
      total: items.length,
      coldChecked,
      coldRequired: cold.length,
      complete: items.length > 0 && picked === items.length && coldChecked === cold.length,
    };
  }, [items]);

  const editable = orderStatus === 'preparing';
  const percent = progress.total === 0 ? 0 : Math.round((progress.picked / progress.total) * 100);

  async function updateItem(itemId: string, body: { picked?: boolean; coldChainChecked?: boolean }) {
    setBusyItemId(itemId);
    setError(null);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/picking`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, ...body }),
      });
      const payload = await res.json().catch(() => null) as { error?: string } | null;
      if (!res.ok) throw new Error(payload?.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de mettre à jour le picking.');
    } finally {
      setBusyItemId(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <header className="border-b border-[var(--admin-border)] px-4 py-4 dark:border-gray-800">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Checklist de préparation</h2>
              {progress.complete && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <IconCircleCheck size={13} /> Préparation terminée
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {progress.picked}/{progress.total} lignes prélevées
              {progress.coldRequired > 0 ? ` · ${progress.coldChecked}/${progress.coldRequired} contrôles froid` : ''}
            </p>
          </div>
          <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{percent}%</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div
            className={`h-full rounded-full transition-[width] ${progress.complete ? 'bg-emerald-500' : 'bg-[var(--admin-primary)]'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        {!editable && !progress.complete && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            Démarrez la préparation de la commande pour utiliser la checklist.
          </p>
        )}
        {error && <p className="mt-3 text-xs font-medium text-red-600" role="alert">{error}</p>}
      </header>

      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {items.map(item => {
          const isCold = item.storage_type === 'fresh' || item.storage_type === 'frozen';
          const picked = Boolean(item.picked_at);
          const coldChecked = Boolean(item.cold_chain_checked_at);
          const busy = busyItemId === item.id;
          const frozen = item.storage_type === 'frozen';
          const fresh = item.storage_type === 'fresh';

          return (
            <div
              key={item.id}
              className={`px-4 py-4 ${picked ? 'bg-emerald-50/30 dark:bg-emerald-950/10' : frozen ? 'bg-blue-50/40 dark:bg-blue-950/10' : fresh ? 'bg-cyan-50/30 dark:bg-cyan-950/10' : ''}`}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className={`flex h-11 min-w-11 shrink-0 items-center justify-center rounded-xl px-2 text-base font-bold ${picked ? 'bg-emerald-600 text-white' : 'bg-gray-950 text-white dark:bg-white dark:text-gray-950'}`}>
                    ×{item.quantity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm font-semibold ${picked ? 'text-gray-500 line-through dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>{item.name}</p>
                      {item.name_alt && <span className="text-xs text-gray-400">{item.name_alt}</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      {item.warehouse_location && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                          <IconMapPin size={12} /> {item.warehouse_location}
                        </span>
                      )}
                      {frozen && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">
                          <IconSnowflake size={12} /> Surgelé
                        </span>
                      )}
                      {fresh && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-1 font-semibold text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200">
                          <IconTemperature size={12} /> Frais
                        </span>
                      )}
                      {!isCold && <span className="text-gray-400">{storageLabel(item.storage_type)}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <button
                    type="button"
                    disabled={!editable || busy}
                    onClick={() => void updateItem(item.id, { picked: !picked })}
                    className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${picked
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
                    }`}
                  >
                    <IconCheck size={14} /> {picked ? 'Prélevé' : 'Marquer prélevé'}
                  </button>

                  {isCold && (
                    <button
                      type="button"
                      disabled={!editable || busy || !picked}
                      onClick={() => void updateItem(item.id, { coldChainChecked: !coldChecked })}
                      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${coldChecked
                        ? 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300'
                        : 'border-sky-200 bg-white text-sky-700 hover:bg-sky-50 dark:border-sky-900 dark:bg-gray-900 dark:text-sky-300'
                      }`}
                    >
                      {frozen ? <IconSnowflake size={14} /> : <IconTemperature size={14} />}
                      {coldChecked ? 'Froid contrôlé' : 'Valider le froid'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
