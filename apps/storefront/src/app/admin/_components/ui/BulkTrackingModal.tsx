'use client';

import { useState } from 'react';
import { IconX } from '@tabler/icons-react';

export interface PendingTrackingOrder {
  id:    string;
  label: string; // es. "#A1B2C3D4 — Jean Dupont"
}

export default function BulkTrackingModal({
  orders,
  carrierOptions,
  onConfirm,
  onCancel,
}: {
  orders: PendingTrackingOrder[];
  carrierOptions: string[];
  onConfirm: (tracking: Record<string, { carrier: string; code: string }>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, { carrier: string; code: string }>>(
    Object.fromEntries(orders.map(o => [o.id, { carrier: carrierOptions[0] ?? '', code: '' }]))
  );

  const allFilled = orders.every(o => values[o.id]?.code?.trim());

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-tracking-title"
      onKeyDown={e => { if (e.key === 'Escape') onCancel(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 id="bulk-tracking-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Code de suivi requis ({orders.length})
          </h2>
          <button onClick={onCancel} aria-label="Fermer" className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <IconX size={16} />
          </button>
        </div>

        <p className="px-5 pt-3 text-xs text-gray-500 dark:text-gray-400">
          Ces commandes n&apos;ont pas encore de code de suivi. Renseignez-le pour les marquer comme expédiées.
        </p>

        <div className="px-5 py-4 space-y-4">
          {orders.map(order => (
            <div key={order.id} className="flex items-center gap-2">
              <span className="text-xs font-mono text-gray-600 dark:text-gray-300 w-32 flex-shrink-0 truncate">
                {order.label}
              </span>
              <select
                value={values[order.id]?.carrier ?? ''}
                onChange={e => setValues(v => ({
                  ...v,
                  [order.id]: { carrier: e.target.value, code: v[order.id]?.code ?? '' },
                }))}
                className="text-xs border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg px-2 py-1.5 flex-shrink-0"
                aria-label={`Transporteur pour ${order.label}`}
              >
                {carrierOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input
                type="text"
                value={values[order.id]?.code ?? ''}
                onChange={e => setValues(v => ({
                  ...v,
                  [order.id]: { carrier: v[order.id]?.carrier ?? (carrierOptions[0] ?? ''), code: e.target.value },
                }))}
                placeholder="Code de suivi"
                className="text-xs border border-gray-200 dark:border-gray-700 dark:bg-gray-800 rounded-lg px-2 py-1.5 flex-1 min-w-0"
                aria-label={`Code de suivi pour ${order.label}`}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
            Annuler
          </button>
          <button
            onClick={() => onConfirm(values)}
            disabled={!allFilled}
            className="text-sm px-3 py-1.5 rounded-lg text-white disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--color-primary-dark)' }}
          >
            Confirmer et expédier
          </button>
        </div>
      </div>
    </div>
  );
}
