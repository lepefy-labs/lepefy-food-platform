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
  /** Without orders.manage the checklist is read-only. */
  canManage?: boolean;
}

function storageLabel(storageType: OrderItem['storage_type']) {
  if (storageType === 'frozen') return 'Surgelé';
  if (storageType === 'fresh') return 'Frais';
  return 'Sec';
}

export default function PickingChecklist({ orderId, orderStatus, items, canManage = true }: Props) {
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

  const editable = orderStatus === 'preparing' && canManage;
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
      setError(err instanceof Error ? err.message : 'Impossible de mettre à jour la préparation.');
    } finally {
      setBusyItemId(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-a-border bg-a-surface shadow-sm">
      <header className="border-b border-a-border px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-a-text">Checklist de préparation</h2>
              {progress.complete && (
                <span className="inline-flex items-center gap-1 rounded-full bg-tone-success-bg px-2 py-1 text-xs font-bold text-tone-success-fg">
                  <IconCircleCheck size={13} /> Préparation terminée
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-a-text-3">
              {progress.picked}/{progress.total} lignes prélevées
              {progress.coldRequired > 0 ? ` · ${progress.coldChecked}/${progress.coldRequired} contrôles froid` : ''}
            </p>
          </div>
          <span className="text-sm font-bold text-a-text">{percent}%</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-a-hover">
          <div
            className={`h-full rounded-full transition-[width] ${progress.complete ? 'bg-tone-success-solid' : 'bg-a-brand'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        {orderStatus !== 'preparing' && canManage && !progress.complete && (
          <p className="mt-3 rounded-lg bg-tone-warning-bg px-3 py-2 text-xs font-medium text-tone-warning-fg">
            Démarrez la préparation de la commande pour utiliser la checklist.
          </p>
        )}
        {error && <p className="mt-3 text-xs font-medium text-tone-danger-fg" role="alert">{error}</p>}
      </header>

      <div className="divide-y divide-a-border">
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
              className={`px-4 py-4 ${picked ? 'bg-tone-success-bg' : frozen ? 'bg-tone-info-bg' : fresh ? 'bg-tone-info-bg' : ''}`}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className={`flex h-11 min-w-11 shrink-0 items-center justify-center rounded-xl px-2 text-base font-bold ${picked ? 'bg-tone-success-solid text-white' : 'bg-a-inverse text-a-on-inverse'}`}>
                    ×{item.quantity}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className={`text-sm font-semibold ${picked ? 'text-a-text-3 line-through' : 'text-a-text'}`}>{item.name}</p>
                      {item.name_alt && <span className="text-xs text-a-text-3">{item.name_alt}</span>}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                      {item.warehouse_location && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-a-hover px-2 py-1 font-semibold text-a-text-2">
                          <IconMapPin size={12} /> {item.warehouse_location}
                        </span>
                      )}
                      {frozen && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-tone-info-bg px-2 py-1 font-semibold text-tone-info-fg">
                          <IconSnowflake size={12} /> Surgelé
                        </span>
                      )}
                      {fresh && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-tone-info-bg px-2 py-1 font-semibold text-tone-info-fg">
                          <IconTemperature size={12} /> Frais
                        </span>
                      )}
                      {!isCold && <span className="text-a-text-3">{storageLabel(item.storage_type)}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <button
                    type="button"
                    disabled={!editable || busy}
                    onClick={() => void updateItem(item.id, { picked: !picked })}
                    className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${picked
                      ? 'border-tone-success-border bg-tone-success-bg text-tone-success-fg hover:bg-tone-success-bg'
                      : 'border-a-border-strong bg-a-surface text-a-text-2 hover:bg-a-surface-2'
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
                        ? 'border-tone-info-border bg-tone-info-bg text-tone-info-fg hover:bg-tone-info-bg'
                        : 'border-tone-info-border bg-a-surface text-tone-info-fg hover:bg-tone-info-bg'
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
